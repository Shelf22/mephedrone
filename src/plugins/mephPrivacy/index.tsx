/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { updateMessage } from "@api/MessageUpdater";
import { isPluginEnabled, plugins, startPlugin } from "@api/PluginManager";
import { definePluginSettings, Settings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { SafetyIcon } from "@components/Icons";
import SettingsPlugin from "@plugins/_core/settings";
import { BRAND } from "@shared/brand";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { removeFromArray } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { CloudUpload, Message } from "@vencord/discord-types";
import { Alerts, ChannelStore, FluxDispatcher, MessageActions, MessageStore, React, SelectedChannelStore, showToast, VoiceActions } from "@webpack/common";

import * as E2E from "./e2e";
import { checkUrl, cleanUrl, findFlagged } from "./links";
import { lock, setIdle, startLock, stopLock } from "./lock";
import managedStyle from "./privacy.css?managed";
import { PrivacyPage } from "./PrivacyPage";
import { startEmbedGuard, stopEmbedGuard } from "./embeds";
import { stripFile } from "./strip";
import { callSecurity, startIpGuard, stopIpGuard } from "./voice";
import { countEvent, startTelemetryBlock, stopTelemetryBlock } from "./telemetry";

const logger = new Logger("MephPrivacy");
const StatusSetting = getUserSettingLazy<string>("status", "status")!;
const ShowCurrentGame = getUserSettingLazy<boolean>("status", "showCurrentGame")!;

interface GhostBackup { status: string; showGame: boolean; silentTyping: boolean; }

export const settings = definePluginSettings({
    // anti-tracking
    blockTelemetry: { type: OptionType.CUSTOM, description: "", default: true, onChange: v => v ? startTelemetryBlock() : stopTelemetryBlock() },
    cleanOpenedLinks: { type: OptionType.CUSTOM, description: "", default: true },
    warnLinks: { type: OptionType.CUSTOM, description: "", default: true },
    readerLink: { type: OptionType.CUSTOM, description: "", default: true },
    allowBadgeLists: { type: OptionType.CUSTOM, description: "", default: false },
    // voice + embeds
    voiceIpGuard: { type: OptionType.CUSTOM, description: "", default: true, onChange: v => v ? startIpGuard() : stopIpGuard() },
    callSecurityBadge: { type: OptionType.CUSTOM, description: "", default: true },
    confirmVoiceJoin: { type: OptionType.CUSTOM, description: "", default: false },
    muteOnJoin: { type: OptionType.CUSTOM, description: "", default: false },
    embedGuard: { type: OptionType.CUSTOM, description: "", default: true, onChange: v => v ? startEmbedGuard() : stopEmbedGuard() },
    // media
    stripMetadata: { type: OptionType.CUSTOM, description: "", default: true },
    toastOnStrip: { type: OptionType.CUSTOM, description: "", default: true },
    // stealth
    autoInvisible: { type: OptionType.CUSTOM, description: "", default: false },
    hideActivity: { type: OptionType.CUSTOM, description: "", default: false },
    ghost: { type: OptionType.CUSTOM, description: "", default: null as GhostBackup | null },
    // lock
    pin: { type: OptionType.CUSTOM, description: "", default: "" },
    lockOnStart: { type: OptionType.CUSTOM, description: "", default: true },
    idleMinutes: { type: OptionType.CUSTOM, description: "", default: 0, onChange: v => setIdle(v) },
});

export function ensurePlugin(name: string) {
    if (isPluginEnabled(name)) return;
    Settings.plugins[name].enabled = true;
    const p = plugins[name];
    if (p) startPlugin(p);
}

export async function setGhost(on: boolean) {
    const typing = Settings.plugins.SilentTyping;
    if (on) {
        if (settings.store.ghost) return "Ghost mode is already on.";
        settings.store.ghost = { status: StatusSetting.getSetting(), showGame: ShowCurrentGame.getSetting(), silentTyping: !!typing?.isEnabled };
        ensurePlugin("SilentTyping");
        await StatusSetting.updateSetting("invisible");
        await ShowCurrentGame.updateSetting(false);
        Settings.plugins.SilentTyping.isEnabled = true;
        return "Ghost mode on: you look offline, your game is hidden and nobody sees you typing.";
    }
    const prev = settings.store.ghost;
    if (!prev) return "Ghost mode is already off.";
    await StatusSetting.updateSetting(prev.status === "invisible" ? "online" : prev.status);
    await ShowCurrentGame.updateSetting(prev.showGame);
    if (typing) typing.isEnabled = prev.silentTyping;
    settings.store.ghost = null;
    return "Ghost mode off: status, activity and typing are back to how they were.";
}

// ---------- encrypted messages

// Discord's message records drop unknown fields, so the decrypt state lives here (message id → state)
const e2eState = new Map<string, "ok" | "nokey">();

async function reveal(channelId: string, message: any) {
    if (!message?.id || typeof message.content !== "string" || !E2E.MARKER.test(message.content)) return;
    const plain = await E2E.decrypt(channelId, message.content);
    e2eState.set(message.id, plain != null ? "ok" : "nokey");
    setTimeout(() => updateMessage(channelId, message.id, plain != null ? { content: plain } : undefined));
}

// Decrypt BEFORE Discord shows anything: message events carrying our ciphertext are held for the
// millisecond decryption takes, then passed on with the plain text. Cached ones are swapped instantly.
const HELD = Symbol("mephE2E");
const E2E_EVENTS = new Set(["MESSAGE_CREATE", "MESSAGE_UPDATE", "LOAD_MESSAGES_SUCCESS", "LOAD_MESSAGES_AROUND_SUCCESS", "SEARCH_FINISH", "LOAD_PINNED_MESSAGES_SUCCESS", "LOAD_RECENT_MENTIONS_SUCCESS"]);
let origDispatch: ((a: any) => any) | null = null;

function messagesIn(action: any): [string, any][] {
    const out: [string, any][] = [];
    const add = (m: any, ch?: string) => {
        if (!m || typeof m !== "object") return;
        out.push([ch ?? m.channel_id, m]);
        if (m.referenced_message) out.push([m.referenced_message.channel_id ?? ch ?? m.channel_id, m.referenced_message]);
    };
    if (action.message) add(action.message, action.channelId);
    for (const m of action.messages ?? []) Array.isArray(m) ? m.forEach(x => add(x)) : add(m, action.channelId);
    return out;
}

function wrapDispatch() {
    if (origDispatch) return;
    origDispatch = FluxDispatcher.dispatch;
    FluxDispatcher.dispatch = function (this: any, action: any) {
        if (action?.type === "VOICE_CHANNEL_SELECT" && !action[HELD] && settings.store.confirmVoiceJoin && action.channelId
            && action.channelId !== SelectedChannelStore.getVoiceChannelId()) {
            const name = ChannelStore.getChannel(action.channelId)?.name ?? "this voice channel";
            action[HELD] = true;
            return new Promise<void>(resolve => Alerts.show({
                title: "Join voice?",
                body: `Join 🔊 ${name}? Everyone in the server will see you joined.`,
                confirmText: "Join", cancelText: "Cancel",
                onConfirm: () => resolve(origDispatch!.call(this, action)),
                onCancel: () => resolve(),
                onCloseCallback: () => resolve(),
            }));
        }
        if (action && !action[HELD] && E2E_EVENTS.has(action.type)) {
            const pending: Promise<void>[] = [];
            for (const [ch, m] of messagesIn(action)) {
                if (typeof m.content !== "string" || !E2E.MARKER.test(m.content)) continue;
                const hit = E2E.cached(m.content);
                if (hit != null) { m.content = hit; if (m.id) e2eState.set(m.id, "ok"); continue; }
                if (!E2E.hasKey(ch)) continue;
                pending.push(E2E.decrypt(ch, m.content).then(plain => {
                    if (plain != null) { m.content = plain; if (m.id) e2eState.set(m.id, "ok"); } else if (m.id) e2eState.set(m.id, "nokey");
                }));
            }
            if (pending.length) {
                action[HELD] = true;
                return Promise.all(pending).catch(() => { }).then(() => origDispatch!.call(this, action));
            }
        }
        return origDispatch!.call(this, action);
    } as any;
}

function unwrapDispatch() {
    if (origDispatch) FluxDispatcher.dispatch = origDispatch as any;
    origDispatch = null;
}

export function rescan(channelId: string) {
    const msgs: any[] = (MessageStore.getMessages(channelId) as any)?._array ?? [];
    msgs.forEach(m => reveal(channelId, m));
}

export function openKeyModal(channelId: string) {
    let value = "";
    Alerts.show({
        title: "🔒 Encrypt this chat",
        body: (
            <div className="meph-keymodal">
                <p>Pick a passphrase and give it to the other person <b>outside Discord</b> (in person, by text, Signal…). Both of you enter the same one here.</p>
                <p>Messages you send here are scrambled before they leave your PC. Discord never sees the text. Friends on normal Discord get a link to a reader page where they type the passphrase once. {BRAND} users with the passphrase see it automatically.</p>
                <input type="password" autoFocus placeholder="Shared passphrase (long is better)" onChange={e => value = e.currentTarget.value} />
            </div>
        ),
        confirmText: E2E.hasKey(channelId) ? "Change key" : "Encrypt chat",
        cancelText: "Cancel",
        secondaryConfirmText: E2E.hasKey(channelId) ? "Remove key" : undefined,
        onConfirmSecondary: async () => { await E2E.forget(channelId); showToast({ text: "Key removed for this chat", variant: "success" }); },
        onConfirm: async () => {
            if (value.length < 8) return showToast({ text: "Use at least 8 characters", variant: "critical" });
            await E2E.setPassphrase(channelId, value);
            rescan(channelId);
            showToast({ text: "This chat is now end-to-end encrypted", variant: "success" });
        },
    });
}

export const LockIcon = ({ on, height = 20, width = 20 }: { on?: boolean; height?: number; width?: number; }) => (
    <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor">
        {on
            ? <path d="M17 9V7A5 5 0 0 0 7 7v2a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-7a3 3 0 0 0-3-3ZM9 7a3 3 0 0 1 6 0v2H9Zm4 10.7V19h-2v-1.3a2 2 0 1 1 2 0Z" />
            : <path d="M17 9H9V7a3 3 0 0 1 5.8-1.1l1.9-.7A5 5 0 0 0 7 7v2a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-7a3 3 0 0 0-3-3Zm-4 8.7V19h-2v-1.3a2 2 0 1 1 2 0Z" opacity=".75" />}
    </svg>
);

const E2EButton: ChatBarButtonFactory = ({ channel, isMainChat }) => {
    const [, force] = React.useState(0);
    React.useEffect(() => E2E.onChange(() => force(n => n + 1)), []);
    if (!isMainChat) return null;
    const on = E2E.isOn(channel.id);
    return (
        <ChatBarButton
            tooltip={on ? "Encrypted: click to send normally, right-click for key" : E2E.hasKey(channel.id) ? "Not encrypting: click to encrypt" : "Encrypt this chat"}
            onClick={async () => {
                if (!E2E.hasKey(channel.id)) return openKeyModal(channel.id);
                await E2E.setOn(channel.id, !on);
            }}
            onContextMenu={e => { e.preventDefault(); openKeyModal(channel.id); }}
        >
            <span style={{ color: on ? "var(--meph-accent, var(--text-feedback-positive))" : undefined, display: "flex" }}><LockIcon on={on} /></span>
        </ChatBarButton>
    );
};

// Second, fail-closed layer: every send path (other plugins, quick replies…) goes through
// MessageActions, so encrypt there too. If encryption can't happen, the message is not sent.
let origSend: ((...a: any[]) => any) | null = null;
let origEdit: ((...a: any[]) => any) | null = null;

async function sealed(channelId: string, content: string) {
    if (!E2E.isOn(channelId) || !content?.trim() || E2E.isSealed(content)) return content;
    if (content.length > E2E.MAX_PLAIN) {
        showToast({ text: `Encrypted messages can be up to ${E2E.MAX_PLAIN} characters`, variant: "critical" });
        throw new Error("too long to encrypt");
    }
    return E2E.encrypt(channelId, content, settings.store.readerLink);
}

function wrapSend() {
    if (origSend) return;
    origSend = MessageActions.sendMessage;
    origEdit = MessageActions.editMessage;
    MessageActions.sendMessage = async function (this: any, channelId: string, msg: any, ...rest: any[]) {
        if (msg && typeof msg.content === "string") msg.content = await sealed(channelId, msg.content);
        return origSend!.call(this, channelId, msg, ...rest);
    } as any;
    MessageActions.editMessage = async function (this: any, channelId: string, messageId: string, msg: any, ...rest: any[]) {
        if (msg && typeof msg.content === "string") msg.content = await sealed(channelId, msg.content);
        return origEdit!.call(this, channelId, messageId, msg, ...rest);
    } as any;
}

function unwrapSend() {
    if (origSend) MessageActions.sendMessage = origSend as any;
    if (origEdit) MessageActions.editMessage = origEdit as any;
    origSend = origEdit = null;
}

// ---------- call security badge (in the user panel while you're in a call)

let badge: HTMLDivElement | null = null;
let badgeTimer: ReturnType<typeof setInterval> | null = null;
let warnedFor = "";

function renderBadge() {
    const sec = callSecurity();
    const panel = document.querySelector<HTMLElement>("section[class*=panels_]");
    if (!settings.store.callSecurityBadge || !sec.inCall || !panel) { badge?.remove(); return; }
    badge ??= document.createElement("div");
    badge.className = "meph-callsec " + (sec.e2ee ? "ok" : "warn");
    badge.textContent = sec.e2ee
        ? `🔒 End-to-end encrypted call (v${sec.version})`
        : sec.others ? "⚠️ This call is NOT end-to-end encrypted" : "🔓 Not end-to-end encrypted yet (you're alone)";
    badge.title = sec.e2ee
        ? "Discord's servers relay this call but can't hear it."
        : "Discord's servers can technically access this call's audio/video. Encryption starts when Discord negotiates it with the other participants.";
    if (badge.parentElement !== panel) panel.prepend(badge);
    const chan = SelectedChannelStore.getVoiceChannelId() ?? "";
    if (sec.others && !sec.e2ee && warnedFor !== chan) {
        warnedFor = chan;
        showToast({ text: "⚠️ This call isn't end-to-end encrypted. Discord can access it.", variant: "critical" });
    }
}

// ---------- link safety

function openExternal(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
}

const TITLES = { iplogger: "⚠️ IP logger link", phishing: "⚠️ Fake / phishing site", qrlogin: "⚠️ Account login link" };

function onLinkClick(e: MouseEvent) {
    const a = (e.target as HTMLElement)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || e.button > 1 || !/^https?:/.test(a.href)) return;
    const url = new URL(a.href);
    if (/(^|\.)discord(app)?\.com$/.test(url.hostname) && !/^\/ra\//.test(url.pathname)) return;

    const verdict = settings.store.warnLinks ? checkUrl(a.href) : null;
    if (verdict) {
        e.preventDefault();
        e.stopImmediatePropagation();
        Alerts.show({
            title: TITLES[verdict.kind],
            body: <div className="meph-linkwarn"><p>{verdict.why}</p><code>{verdict.host}</code></div>,
            confirmText: "Go back",
            cancelText: "Open anyway",
            onCancel: () => openExternal(a.href),
        });
        return;
    }
    if (settings.store.cleanOpenedLinks) {
        const clean = cleanUrl(a.href);
        if (clean !== a.href) {
            e.preventDefault();
            e.stopImmediatePropagation();
            openExternal(clean);
        }
    }
}

// ---------- plugin

export default definePlugin({
    name: "MephPrivacy",
    description: `${BRAND} privacy suite: anti-tracking, encrypted messages, stealth, lock screen and link safety`,
    tags: ["Privacy"],
    authors: [Devs.MephedroneTeam],
    required: true,
    settings,
    managedStyle,
    dependencies: ["ClearURLs", "AnonymiseFileNames", "MessageUpdaterAPI", "ChatInputButtonAPI", "MessageAccessoriesAPI", "MessageEventsAPI", "CommandsAPI"],

    patches: [
        {
            find: "async uploadFiles(",
            replacement: {
                match: /async uploadFiles\((\i)\){/,
                replace: "$&await $self.stripUploads($1);"
            }
        }
    ],

    async stripUploads(uploads: CloudUpload[]) {
        if (!settings.store.stripMetadata || !Array.isArray(uploads)) return;
        let cleaned = 0;
        await Promise.all(uploads.map(async upload => {
            try {
                const file = upload?.item?.file;
                if (!(file instanceof File) || !/^image\/(jpeg|png|webp)$/.test(file.type)) return;
                const res = await stripFile(file);
                if (!res) return;
                upload.item.file = res.file;
                if (typeof upload.currentSize === "number") upload.currentSize = res.file.size;
                if (typeof upload.preCompressionSize === "number") upload.preCompressionSize = res.file.size;
                cleaned++;
            } catch (e) {
                logger.error("Couldn't strip", upload?.filename, e);
            }
        }));
        if (cleaned && settings.store.toastOnStrip)
            showToast({ text: `Removed hidden photo info (location, camera) from ${cleaned} file${cleaned > 1 ? "s" : ""}`, variant: "success" });
    },

    // Only the length check happens here. Encryption itself runs at the very last step (the MessageActions
    // wrapper), after store plugins may have changed the text, so they never see or touch ciphertext.
    onBeforeMessageSend(channelId, msg) {
        if (E2E.isOn(channelId) && msg.content.length > E2E.MAX_PLAIN) {
            showToast({ text: `Encrypted messages can be up to ${E2E.MAX_PLAIN} characters`, variant: "critical" });
            return { cancel: true };
        }
    },

    chatBarButton: { icon: () => <LockIcon on />, render: E2EButton },

    renderMessageAccessory(props: Record<string, any>) {
        const message = props.message as Message;
        const state = e2eState.get(message.id);
        const parts: React.ReactNode[] = [];
        if (state === "ok") parts.push(<div key="e2e" className="meph-acc meph-acc-ok"><LockIcon on width={13} height={13} /> End-to-end encrypted</div>);
        if (state === "nokey" || (!state && E2E.MARKER.test(message.content ?? "")))
            parts.push(
                <div key="e2e" className="meph-acc meph-acc-locked">
                    <LockIcon on width={13} height={13} /> Encrypted message.
                    <a onClick={() => openKeyModal(message.channel_id)}> Enter the chat key</a> to read it.
                </div>
            );
        if (settings.store.warnLinks && message.content)
            for (const v of findFlagged(message.content))
                parts.push(<div key={v.host} className="meph-acc meph-acc-warn">⚠️ {TITLES[v.kind].replace("⚠️ ", "")}: <b>{v.host}</b>. {v.why}</div>);
        return parts.length ? <>{parts}</> : null;
    },

    flux: {
        MESSAGE_CREATE({ message, channelId }: { message: any; channelId: string; }) { reveal(channelId ?? message?.channel_id, message); },
        MESSAGE_UPDATE({ message }: { message: any; }) { reveal(message?.channel_id, message); },
        LOAD_MESSAGES_SUCCESS({ channelId, messages }: { channelId: string; messages: any[]; }) { messages?.forEach(m => reveal(channelId, m)); },
        TRACK() {
            if (settings.store.blockTelemetry && Settings.plugins.NoTrack?.disableAnalytics !== false) countEvent();
        },
        RTC_CONNECTION_STATE({ state }: { state: string; }) {
            if (state === "RTC_CONNECTED") {
                warnedFor = "";
                try { if (settings.store.muteOnJoin && !(Vencord.Webpack.findStore("MediaEngineStore") as any).isSelfMute()) VoiceActions.toggleSelfMute(); } catch { }
            }
            renderBadge();
        },
        CONNECTION_OPEN() {
            wrapSend();
            wrapDispatch();
            if (settings.store.autoInvisible && !settings.store.ghost) StatusSetting.updateSetting("invisible").catch(() => { });
            if (settings.store.hideActivity) ShowCurrentGame.updateSetting(false).catch(() => { });
        },
    },

    commands: [
        {
            name: "ghost",
            description: "Look offline, hide your game and typing (or undo it)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{ name: "on", description: "true = ghost, false = back to normal (default: toggle)", type: ApplicationCommandOptionType.BOOLEAN, required: false }],
            async execute(args, ctx) {
                const text = await setGhost(findOption<boolean>(args, "on", !settings.store.ghost)).catch(e => `Ghost mode failed: ${e}`);
                sendBotMessage(ctx.channel.id, { content: text });
            },
        },
        {
            name: "lock",
            description: "Lock the client now (same as Ctrl+Shift+L)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute(_, ctx) {
                if (!settings.store.pin) return void sendBotMessage(ctx.channel.id, { content: `Set a PIN first in Settings › ${BRAND} › Privacy.` });
                lock();
            },
        },
    ],

    async start() {
        await E2E.load();
        // started at runtime after the connection is already up: wrap now (otherwise CONNECTION_OPEN does it)
        if (FluxDispatcher) { wrapSend(); wrapDispatch(); }
        if (settings.store.blockTelemetry) startTelemetryBlock();
        if (settings.store.voiceIpGuard) startIpGuard();
        if (settings.store.embedGuard) startEmbedGuard();
        badgeTimer = setInterval(renderBadge, 2000);
        document.addEventListener("click", onLinkClick, true);
        document.addEventListener("auxclick", onLinkClick, true);
        startLock({ hash: () => settings.store.pin, idleMinutes: settings.store.idleMinutes, lockNow: settings.store.lockOnStart });
        SettingsPlugin.customEntries.push({ key: "meph_privacy", title: "Privacy", panelTitle: `${BRAND} Privacy`, Component: PrivacyPage, Icon: SafetyIcon });
    },

    stop() {
        stopIpGuard();
        stopEmbedGuard();
        if (badgeTimer) clearInterval(badgeTimer);
        badge?.remove();
        unwrapSend();
        unwrapDispatch();
        stopTelemetryBlock();
        document.removeEventListener("click", onLinkClick, true);
        document.removeEventListener("auxclick", onLinkClick, true);
        stopLock();
        removeFromArray(SettingsPlugin.customEntries, e => e.key === "meph_privacy");
    },
});
