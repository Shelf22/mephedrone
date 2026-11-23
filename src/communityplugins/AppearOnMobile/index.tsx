/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings, SettingsStore } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, StartAt } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { Menu, PresenceStore, SelectedChannelStore, showToast, UserStore, useStateFromStores } from "@webpack/common";

const logger = new Logger("AppearOnMobile");

// Gateway opcode of the login payload
const OP_IDENTIFY = 2;

/**
 * What Discord's login says for each choice. "browser" is the only value changed;
 * null means the login is sent untouched (normal desktop app).
 */
const PLATFORMS = {
    desktop: { label: "Desktop (normal)", browser: null },
    android: { label: "Mobile (Android)", browser: "Discord Android" },
    ios: { label: "Mobile (iOS)", browser: "Discord iOS" },
    // Real browsers send their own name; Discord counts anything that is not one of its apps as web
    web: { label: "Web browser", browser: "Chrome" },
    embedded: { label: "Console (Embedded)", browser: "Discord Embedded" },
    vr: { label: "VR headset", browser: "Discord VR" }
} as const;

type PlatformKey = keyof typeof PLATFORMS;

const SETTING_PATH = "plugins.AppearOnMobile.platform";

const settings = definePluginSettings({
    platform: {
        type: OptionType.SELECT,
        description: "Which device others see you on. Also in the status menu (click your avatar, then your status). Discord reconnects for a second to apply it; in a voice channel, it waits until you leave.",
        options: (Object.keys(PLATFORMS) as PlatformKey[]).map(key => ({
            label: PLATFORMS[key].label,
            value: key,
            default: key === "android"
        }))
    }
});

function getPlatformKey(): PlatformKey {
    const key = settings.store.platform as PlatformKey;
    return key in PLATFORMS ? key : "android";
}

/** The value to send right now: null when the login must go through untouched */
function getWantedBrowser(): string | null {
    return active ? PLATFORMS[getPlatformKey()].browser : null;
}

// GatewayConnectionStore.getSocket() is Discord's gateway connection (class GatewaySocket)
const GatewayConnectionStore = findStoreLazy("GatewayConnectionStore");
// Your own logged in sessions, with the device Discord sees for each one
const SessionsStore = findStoreLazy("SessionsStore");
// Not exported by every Vencord version, so looked up directly
const SelfPresenceStore = findStoreLazy("SelfPresenceStore");

/** Discord allows one login every 5 seconds */
const MIN_DELAY_BETWEEN_LOGINS = 6000;

let active = false;
let hooksInstalled = false;
let originalSend: typeof WebSocket.prototype.send | null = null;
/** When the last login was sent */
let lastLoginAt = 0;
let switchTimer: ReturnType<typeof setTimeout> | undefined;
/** Whether a login was seen since the plugin started */
let loginSeen = false;
/** What the current session's login asked for (null: normal desktop app) */
let loginBrowser: string | null = null;
/** Set when we reconnected on purpose, to confirm the result once Discord is back */
let switchPending = false;
let waitingForVoiceLeave = false;

/* ---------- Login payloads ---------- */

interface Inspected {
    isLogin: boolean;
    /** The payload to send instead, or null to send it unchanged */
    rewritten: string | Uint8Array | null;
}

const NOT_LOGIN: Inspected = { isLogin: false, rewritten: null };

function inspectJson(data: string, browser: string | null): Inspected {
    if (!data.includes(`"op":${OP_IDENTIFY}`)) return NOT_LOGIN;
    let payload: any;
    try {
        payload = JSON.parse(data);
    } catch {
        return NOT_LOGIN;
    }
    if (payload?.op !== OP_IDENTIFY || !payload.d) return NOT_LOGIN;
    if (browser == null) return { isLogin: true, rewritten: null };

    payload.d.properties ??= {};
    payload.d.properties.browser = browser;
    return { isLogin: true, rewritten: JSON.stringify(payload) };
}

/* ETF payloads (desktop / erlpack encoding) */

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

interface StringSpan {
    path: string;
    start: number;
    end: number;
}

/**
 * Minimal Erlang External Term Format reader. It only walks the payload to find
 * the "op" value and the byte position of the "browser" string, so that string
 * can be swapped without re-encoding (and possibly altering) the rest of the payload.
 */
class EtfReader {
    pos = 1; // byte 0 is the version tag (131)
    view: DataView;
    spans: StringSpan[] = [];
    /** Byte position of the entry count of each map, to add entries to it */
    maps: { path: string; countPos: number; }[] = [];

    constructor(public bytes: Uint8Array) {
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    u8() { return this.bytes[this.pos++]; }
    u16() { const v = this.view.getUint16(this.pos); this.pos += 2; return v; }
    u32() { const v = this.view.getUint32(this.pos); this.pos += 4; return v; }
    str(len: number) {
        const s = textDecoder.decode(this.bytes.subarray(this.pos, this.pos + len));
        this.pos += len;
        return s;
    }

    read(path: string): any {
        const start = this.pos;
        const tag = this.u8();
        switch (tag) {
            case 97: return this.u8(); // SMALL_INTEGER
            case 98: { const v = this.view.getInt32(this.pos); this.pos += 4; return v; } // INTEGER
            case 70: this.pos += 8; return 0; // NEW_FLOAT (value not needed)
            case 99: this.pos += 31; return 0; // FLOAT
            case 110: { const n = this.u8(); this.pos += 1 + n; return 0; } // SMALL_BIG
            case 111: { const n = this.u32(); this.pos += 1 + n; return 0; } // LARGE_BIG
            case 100: case 118: { // ATOM, ATOM_UTF8
                const s = this.str(this.u16());
                this.spans.push({ path, start, end: this.pos });
                return s;
            }
            case 115: case 119: { // SMALL_ATOM, SMALL_ATOM_UTF8
                const s = this.str(this.u8());
                this.spans.push({ path, start, end: this.pos });
                return s;
            }
            case 109: { // BINARY (strings)
                const s = this.str(this.u32());
                this.spans.push({ path, start, end: this.pos });
                return s;
            }
            case 107: return this.str(this.u16()); // STRING (list of small ints)
            case 106: return []; // NIL
            case 108: { // LIST
                const n = this.u32();
                const list: any[] = [];
                for (let i = 0; i < n; i++) list.push(this.read(`${path}[]`));
                this.read(`${path}[]`); // tail
                return list;
            }
            case 104: case 105: { // SMALL_TUPLE, LARGE_TUPLE
                const n = tag === 104 ? this.u8() : this.u32();
                const tuple: any[] = [];
                for (let i = 0; i < n; i++) tuple.push(this.read(`${path}()`));
                return tuple;
            }
            case 116: { // MAP
                this.maps.push({ path, countPos: this.pos });
                const n = this.u32();
                const map: Record<string, any> = {};
                for (let i = 0; i < n; i++) {
                    const key = String(this.read(`${path}#key`));
                    map[key] = this.read(path ? `${path}.${key}` : key);
                }
                return map;
            }
            default:
                throw new Error(`Unsupported ETF tag ${tag}`);
        }
    }
}

function encodeEtfBinary(value: string) {
    const str = textEncoder.encode(value);
    const out = new Uint8Array(5 + str.length);
    out[0] = 109;
    new DataView(out.buffer).setUint32(1, str.length);
    out.set(str, 5);
    return out;
}

function concatBytes(...parts: Uint8Array[]) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let pos = 0;
    for (const p of parts) {
        out.set(p, pos);
        pos += p.length;
    }
    return out;
}

function inspectEtf(bytes: Uint8Array, browser: string | null): Inspected {
    if (bytes[0] !== 131) return NOT_LOGIN;

    let payload: any;
    const reader = new EtfReader(bytes);
    try {
        payload = reader.read("");
    } catch (e) {
        logger.error("Could not read a gateway payload", e);
        return NOT_LOGIN;
    }
    if (payload?.op !== OP_IDENTIFY) return NOT_LOGIN;
    if (browser == null) return { isLogin: true, rewritten: null };

    const replacement = encodeEtfBinary(browser);

    const span = reader.spans.find(s => s.path === "d.properties.browser");
    if (span) {
        return { isLogin: true, rewritten: concatBytes(bytes.subarray(0, span.start), replacement, bytes.subarray(span.end)) };
    }

    // No browser in the login payload: add it to the "properties" map
    const propsMap = reader.maps.find(m => m.path === "d.properties");
    if (!propsMap) {
        logger.warn("The login payload has no platform information, it was sent unchanged");
        return { isLogin: true, rewritten: null };
    }
    const insertPos = propsMap.countPos + 4;
    const out = concatBytes(bytes.subarray(0, insertPos), encodeEtfBinary("browser"), replacement, bytes.subarray(insertPos));
    const view = new DataView(out.buffer);
    view.setUint32(propsMap.countPos, view.getUint32(propsMap.countPos) + 1);
    return { isLogin: true, rewritten: out };
}

/* ---------- WebSocket hooks ---------- */

function isGatewaySocket(ws: WebSocket) {
    return typeof ws.url === "string" && ws.url.includes("gateway");
}

function inspectPayload(data: any, browser: string | null): Inspected {
    if (typeof data === "string") return inspectJson(data, browser);
    if (data instanceof ArrayBuffer) return inspectEtf(new Uint8Array(data), browser);
    if (ArrayBuffer.isView(data)) return inspectEtf(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), browser);
    return NOT_LOGIN;
}

function patchedSend(this: WebSocket, data: any) {
    if (isGatewaySocket(this)) {
        try {
            const browser = getWantedBrowser();
            const result = inspectPayload(data, browser);
            if (result.isLogin) {
                loginSeen = true;
                loginBrowser = browser;
                lastLoginAt = Date.now();
                if (result.rewritten != null) {
                    logger.info(`Login sent as "${browser}"`);
                    data = result.rewritten;
                }
            }
        } catch (e) {
            logger.error("Failed to rewrite a gateway payload", e);
        }
    }
    return originalSend!.call(this, data);
}

/**
 * The hook is installed once. If another plugin (like PreventOnlineStatusOnLogin) wrapped
 * it afterwards, ours stays in place as a pass-through, so its wrapper keeps working.
 */
function installHook() {
    if (hooksInstalled) return;
    originalSend = WebSocket.prototype.send;
    WebSocket.prototype.send = patchedSend;
    hooksInstalled = true;
}

function removeHook() {
    if (!hooksInstalled || WebSocket.prototype.send !== patchedSend) return;
    WebSocket.prototype.send = originalSend!;
    originalSend = null;
    hooksInstalled = false;
}

/* ---------- Switching without restarting Discord ---------- */

type SwitchResult = "none" | "started" | "deferred" | "voice" | "failed";

function isLoggedIn() {
    return UserStore?.getCurrentUser?.() != null;
}

function isInVoice() {
    try {
        return SelectedChannelStore?.getVoiceChannelId?.() != null;
    } catch {
        return false;
    }
}

function getSocket(): any {
    try {
        const socket = GatewayConnectionStore.getSocket();
        if (socket != null && typeof socket._handleReconnect === "function" && typeof socket.isSessionEstablished === "function" && "sessionId" in socket)
            return socket;
    } catch (e) {
        logger.error("Could not find Discord's connection", e);
    }
    logger.warn("Discord's connection code has changed; restart Discord to apply the platform");
    return null;
}

function onVoiceChange() {
    if (isInVoice()) return;
    stopWaitingForVoice();
    notify(syncPlatform());
}

function waitForVoiceLeave() {
    if (waitingForVoiceLeave) return;
    waitingForVoiceLeave = true;
    SelectedChannelStore.addChangeListener(onVoiceChange);
}

function stopWaitingForVoice() {
    if (!waitingForVoiceLeave) return;
    waitingForVoiceLeave = false;
    SelectedChannelStore.removeChangeListener(onVoiceChange);
}

/**
 * Makes Discord log in again (new session) when the current session was not made
 * with the wanted platform. This does what Discord does when its servers ask it to
 * reconnect, except that there is no session to resume, so a full login is sent.
 */
function syncPlatform(): SwitchResult {
    if (!isLoggedIn() || getWantedBrowser() === loginBrowser) {
        stopWaitingForVoice();
        return "none";
    }

    const socket = getSocket();
    if (socket == null) return "failed";

    if (!socket.isSessionEstablished()) {
        // Discord is (re)connecting: make it log in fresh instead of resuming the old
        // session. If its login was already sent, CONNECTION_OPEN checks again.
        socket.sessionId = null;
        return "deferred";
    }

    // A new session would drop the voice call, so wait until the user leaves it
    if (isInVoice()) {
        waitForVoiceLeave();
        return "voice";
    }
    stopWaitingForVoice();

    // Too soon after the last login: try again in a moment (the latest choice wins)
    const wait = lastLoginAt + MIN_DELAY_BETWEEN_LOGINS - Date.now();
    if (wait > 0) {
        clearTimeout(switchTimer);
        switchTimer = setTimeout(() => notify(syncPlatform()), wait);
        return "deferred";
    }

    switchPending = true;
    // Close code 1000 ends the old session right away. Discord's own close (code 4000)
    // would keep it alive for a few minutes, still showing the old device.
    try {
        socket.webSocket?.close(1000, "Switching platform");
    } catch { }
    socket.sessionId = null; // nothing to resume: Discord sends a new login
    socket._handleReconnect();
    return "started";
}

function notify(result: SwitchResult) {
    const label = active ? PLATFORMS[getPlatformKey()].label : PLATFORMS.desktop.label;
    switch (result) {
        case "started":
            showToast(`Reconnecting as: ${label}`, "message");
            break;
        case "deferred":
            showToast(`${label} will apply in a few seconds`, "message");
            break;
        case "voice":
            showToast(`${label} will apply when you leave the voice channel`, "message");
            break;
        case "failed":
            showToast("AppearOnMobile: restart Discord to apply the change", "failure");
            break;
    }
}

function onPlatformChange() {
    if (active) notify(syncPlatform());
}

/** After a connection, apply a change made while Discord was connecting */
function recheckLater() {
    if (!loginSeen || getWantedBrowser() === loginBrowser) return;
    // Not inside Discord's dispatch: reconnecting tears down the socket that is dispatching
    setTimeout(() => notify(syncPlatform()), 0);
}

/* ---------- Your own avatar ---------- */

const NO_DEVICE = { isMobile: false, isVR: false };
const MOBILE_DEVICE = { isMobile: true, isVR: false };
const VR_DEVICE = { isMobile: false, isVR: true };

/**
 * Discord never shows the phone or VR icon on your own avatar. This computes it from
 * your sessions, with Discord's own rule: the phone icon only when you are online on
 * mobile and not on a computer or in VR at the same time.
 */
function getOwnDevice() {
    if (!active) return NO_DEVICE;
    try {
        const online = new Set<string>();
        for (const session of Object.values(SessionsStore.getSessions() ?? {}) as any[]) {
            const client = session?.clientInfo?.client;
            if (client && session.status === "online") online.add(client);
        }
        return {
            isMobile: online.has("mobile") && !online.has("desktop") && !online.has("vr"),
            isVR: online.has("vr")
        };
    } catch {
        return NO_DEVICE;
    }
}

/** Same as getOwnDevice, for the account panel: redraws it when your sessions change */
function useOwnDevice() {
    const device = useStateFromStores([SessionsStore], () => {
        const { isMobile, isVR } = getOwnDevice();
        return isVR ? "vr" : isMobile ? "mobile" : "none";
    });
    return device === "vr" ? VR_DEVICE : device === "mobile" ? MOBILE_DEVICE : NO_DEVICE;
}

function isOwnId(userId: string) {
    return active && userId != null && userId === UserStore?.getCurrentUser?.()?.id;
}

/**
 * Lists that only listen to PresenceStore redraw when it changes, so nudge it when your
 * sessions change. The member list rebuilds your own row when SelfPresenceStore changes.
 */
function refreshOwnAvatar() {
    setTimeout(() => {
        try {
            (PresenceStore as any)?.emitChange?.();
            (SelfPresenceStore as any)?.emitChange?.();
        } catch (e) {
            logger.error("Could not refresh your avatar", e);
        }
    }, 0);
}

/* ---------- Status menu ---------- */

function DeviceIcon({ height = 24, width = 24, className }: { height?: number | string; width?: number | string; className?: string; }) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="currentColor"
                fillRule="evenodd"
                d="M8 2a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V5a3 3 0 0 0-3-3H8ZM7 5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v11H7V5Zm5 12.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z"
            />
        </svg>
    );
}

const statusMenuPatch: NavContextMenuPatchCallback = (children, popoutProps?: { onClose?(): void; }) => {
    const current = getPlatformKey();
    const items = [
        <Menu.MenuSeparator key="vc-appear-on-separator" />,
        <Menu.MenuItem
            id="vc-appear-on"
            key="vc-appear-on"
            label="Appear on"
            subtext={PLATFORMS[current].label}
            iconLeft={DeviceIcon}
            leadingAccessory={{ type: "icon", icon: DeviceIcon }}
        >
            {(Object.keys(PLATFORMS) as PlatformKey[]).map(key => (
                <Menu.MenuRadioItem
                    id={`vc-appear-on-${key}`}
                    key={key}
                    group="vc-appear-on"
                    label={PLATFORMS[key].label}
                    checked={key === current}
                    action={() => {
                        if (key !== getPlatformKey()) settings.store.platform = key;
                        popoutProps?.onClose?.();
                    }}
                />
            ))}
        </Menu.MenuItem>
    ];

    // Right after "Invisible", before Discord's focus mode entry when there is one
    const group = findGroupChildrenByChildId("invisible", children);
    const index = group?.findIndex(c => c?.props?.id === "invisible") ?? -1;
    if (group && index !== -1) group.splice(index + 1, 0, ...items);
    else children.push(...items);
};

/* ---------- Plugin ---------- */

interface ConnectionOpenSession {
    sessionId?: string;
    clientInfo?: { client?: string; };
}

export default definePlugin({
    name: "AppearOnMobile",
    description: "⚠️ May be outdated for the current Discord. Choose which device others see you on (mobile, desktop, web, console, VR) from the status menu",
    tags: ["Privacy", "Fun"],
    authors: [{ name: "TheUnknownMurda", id: 338163169782398977n }],
    settings,
    // The platform is only sent when Discord logs in, so it must be set up before the first login
    startAt: StartAt.Init,

    contextMenus: {
        "set-status-submenu": statusMenuPatch
    },

    // ⚠️ These patches depend on Discord's internal code and can break with a Discord update
    patches: [
        // PresenceStore: answer for yourself too (profile popout, member list, DMs)
        {
            find: "getClientStatus(e){return",
            replacement: [
                {
                    match: /isMobileOnline\((\i)\)\{/,
                    replace: "$&if($self.isOwnId($1))return $self.getOwnDevice().isMobile;"
                },
                {
                    match: /isVROnline\((\i)\)\{/,
                    replace: "$&if($self.isOwnId($1))return $self.getOwnDevice().isVR;"
                }
            ]
        },
        // Account panel (bottom left): its avatar never gets the phone / VR flags
        {
            find: "handleOpenSettingsContextMenu=",
            replacement: [
                {
                    // At the top of the panel avatar component, so it redraws when your sessions change
                    match: /"data-jump-section":\i\}=\i,/,
                    replace: "$&vcOwnDevice=$self.useOwnDevice(),"
                },
                {
                    match: /status:(\i\?\i\.\i\.STREAMING:\i),isSpeaking:/,
                    replace: "status:$1,...vcOwnDevice,isSpeaking:"
                }
            ]
        }
    ],

    isOwnId,
    getOwnDevice,
    useOwnDevice,

    flux: {
        // Discord turns the gateway's READY into CONNECTION_OPEN (a new session)
        CONNECTION_OPEN({ sessionId, sessions }: { sessionId?: string; sessions?: ConnectionOpenSession[]; }) {
            if (!active) return;

            const client = sessions?.find(s => s.sessionId === sessionId)?.clientInfo?.client;
            logger.info(`Connected. Discord sees this session as: ${client ?? "unknown"}`);

            if (!loginSeen && getWantedBrowser() != null) {
                logger.warn("The login payload was not seen. Discord may have changed how it connects; you probably still appear on desktop.");
            }

            if (switchPending) {
                switchPending = false;
                showToast(client ? `Discord now sees you on: ${client}` : "Platform switched", "success");
            }

            refreshOwnAvatar();
            recheckLater();
        },
        // Your sessions changed (a status change, another device connecting...)
        SESSIONS_REPLACE() {
            if (active) refreshOwnAvatar();
        },
        // A resumed session keeps the platform of its login
        CONNECTION_RESUMED() {
            if (active) recheckLater();
        }
    },

    start() {
        active = true;
        switchPending = false;
        installHook();
        SettingsStore.addChangeListener(SETTING_PATH, onPlatformChange);

        if (isLoggedIn()) {
            // Enabled by hand while Discord is running: the current session was made by the normal app
            if (!loginSeen) loginBrowser = null;
            loginSeen = true;
            notify(syncPlatform());
        }
    },

    stop() {
        SettingsStore.removeChangeListener(SETTING_PATH, onPlatformChange);
        active = false; // from now on, logins go through untouched
        refreshOwnAvatar();
        // Log in again as the normal app (in a voice channel, once the user leaves it)
        if (isLoggedIn()) notify(syncPlatform());
        removeHook();
    }
});
