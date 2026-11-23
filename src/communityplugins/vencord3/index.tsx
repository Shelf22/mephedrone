/*
 * Hideaway - Vencord plugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Hides chosen servers and DMs behind a passcode. The entry point is
 * disguised as Discord's own Discover button: a normal click still opens
 * Discover, a right-click asks for the passcode (or locks again). While
 * unlocked, hidden servers are listed right under the Discover button.
 */

import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findStore } from "@webpack";
import {
    ChannelStore,
    Menu,
    NavigationRouter,
    PrivateChannelSortStore,
    SelectedChannelStore,
    SelectedGuildStore
} from "@webpack/common";

import { openUnlockModal, PasscodeSetting, renderSection, useHideawayVersion } from "./components";
import * as Store from "./store";

const logger = new Logger("Hideaway");

/** Discord's list navigator builds ids as `${navId}___${itemId}` */
const DISCOVER_BUTTON = '[data-list-item-id$="___guild-discover-button"]';
const IDLE_CHECK_MS = 10_000;

const settings = definePluginSettings({
    passcode: {
        type: OptionType.COMPONENT,
        component: PasscodeSetting
    },
    requireShift: {
        type: OptionType.BOOLEAN,
        description: "Only react to Shift + right-click on the Discover button, so a plain right-click does nothing",
        default: false
    },
    autoLockMinutes: {
        type: OptionType.SLIDER,
        description: "Lock again after this long without using Discord",
        default: 5,
        markers: [0, 1, 2, 5, 10, 15, 30, 60],
        stickToMarkers: true,
        componentProps: {
            onValueRender: (v: number) => v === 0 ? "Never" : `${v} min`
        }
    },
    lockOnBlur: {
        type: OptionType.BOOLEAN,
        description: "Lock as soon as you switch to another window",
        default: false
    },
    muteWhileLocked: {
        type: OptionType.BOOLEAN,
        description: "Block notifications and sounds from hidden servers and DMs while locked",
        default: true
    }
});

let running = false;
let lastActivity = Date.now();
let idleTimer: ReturnType<typeof setInterval> | null = null;
const cleanups: Array<() => void> = [];

/* ---------- server list ---------- */

/** Hidden servers leave their spot in the list (locked or not), and leave their folder too. */
const isOutOfList = (guildId: string) => !Store.isLoaded() || Store.isGuildHidden(guildId);

const folderCache = new WeakMap<object, { children: any[]; version: number; result: any; }>();

function filterFolder(folder: any) {
    const version = Store.getVersion();
    const cached = folderCache.get(folder);
    if (cached && cached.children === folder.children && cached.version === version) return cached.result;

    const kept = folder.children.filter((child: any) => child?.type !== "guild" || !isOutOfList(child.id));
    // Keep the original object when nothing changed, so React and drag & drop see the same node
    const result = kept.length === folder.children.length ? folder
        : kept.length ? { ...folder, children: kept }
            : null;
    folderCache.set(folder, { children: folder.children, version, result });
    return result;
}

function filterRoots(roots: any[]) {
    if (!running || !Array.isArray(roots)) return roots;

    let changed = false;
    const out: any[] = [];
    for (const node of roots) {
        if (node?.type === "guild" && isOutOfList(node.id)) {
            changed = true;
        } else if (node?.type === "folder" && Array.isArray(node.children)) {
            const folder = filterFolder(node);
            if (folder !== node) changed = true;
            if (folder) out.push(folder);
        } else {
            out.push(node);
        }
    }
    return changed ? out : roots;
}

/* ---------- DM list ---------- */

/**
 * Filters a store method that returns channel ids. Patched on the store
 * instance, so the DM list, the unread DM bubbles and Alt+Up/Down all agree.
 */
function filterIdMethod(store: any, method: string) {
    if (typeof store?.[method] !== "function") {
        logger.warn(`Can't hook ${store?.getName?.() ?? "store"}.${method}`);
        return;
    }
    const original = store[method];
    const hadOwn = Object.prototype.hasOwnProperty.call(store, method);
    let lastIn: unknown;
    let lastOut: unknown;
    let lastVersion = -1;

    store[method] = function (this: unknown, ...args: unknown[]) {
        const ids = original.apply(this, args);
        if (!running || !Array.isArray(ids)) return ids;

        // Same input and state -> same array, so React doesn't re-render for nothing
        const version = Store.getVersion();
        if (ids === lastIn && version === lastVersion) return lastOut;
        lastIn = ids;
        lastVersion = version;
        lastOut = ids.some(Store.isChannelConcealed) ? ids.filter(id => !Store.isChannelConcealed(id)) : ids;
        return lastOut;
    };

    cleanups.push(() => {
        if (hadOwn) store[method] = original;
        else delete store[method];
        store.emitChange?.();
    });
    return store;
}

let channelStores: any[] = [];

function refreshChannelStores() {
    for (const store of channelStores) {
        try {
            store.emitChange();
        } catch (err) {
            logger.error("Failed to refresh", store?.getName?.(), err);
        }
    }
}

/* ---------- locking ---------- */

/** Move away from a hidden server or DM, e.g. right after locking. */
function leaveIfConcealed() {
    if (!running || !Store.isLoaded()) return;
    const guildId = SelectedGuildStore.getGuildId();
    const channelId = SelectedChannelStore.getChannelId();
    if (Store.isGuildConcealed(guildId) || Store.isChannelConcealed(channelId)) {
        NavigationRouter.transitionTo("/channels/@me");
    }
}

function onContextMenu(e: MouseEvent) {
    const target = e.target as Element | null;
    if (!target?.closest?.(DISCOVER_BUTTON)) return;
    if (settings.store.requireShift && !e.shiftKey) return;

    e.preventDefault();
    e.stopPropagation();
    if (Store.isUnlocked()) Store.lock();
    else openUnlockModal();
}

const onActivity = () => {
    lastActivity = Date.now();
};

const onBlur = () => {
    if (settings.store.lockOnBlur) Store.lock();
};

function checkIdle() {
    const minutes = settings.store.autoLockMinutes;
    if (minutes > 0 && Store.isUnlocked() && Date.now() - lastActivity > minutes * 60_000) Store.lock();
}

/* ---------- context menus (only while unlocked) ---------- */

function menuGroup(id: string, hidden: boolean, toggle: () => void) {
    return (
        <Menu.MenuGroup>
            <Menu.MenuItem
                id={id}
                label={hidden ? "Remove from Hideaway" : "Move to Hideaway"}
                action={toggle}
            />
        </Menu.MenuGroup>
    );
}

const guildContextPatch: NavContextMenuPatchCallback = (children, { guild }) => {
    if (!running || !guild?.id || !Store.isUnlocked()) return;
    const hidden = Store.isGuildHidden(guild.id);
    children.push(menuGroup("vc-hideaway-guild", hidden, () => Store.setGuildHidden(guild.id, !hidden)));
};

const userContextPatch: NavContextMenuPatchCallback = (children, { user, channel }) => {
    if (!running || !Store.isUnlocked()) return;
    const dmId = channel?.isDM?.() ? channel.id : user?.id ? ChannelStore.getDMFromUserId(user.id) : null;
    if (!dmId) return;
    const hidden = Store.isChannelHidden(dmId);
    children.push(menuGroup("vc-hideaway-dm", hidden, () => Store.setChannelHidden(dmId, !hidden)));
};

const groupDmContextPatch: NavContextMenuPatchCallback = (children, { channel }) => {
    if (!running || !channel?.id || !Store.isUnlocked()) return;
    const hidden = Store.isChannelHidden(channel.id);
    children.push(menuGroup("vc-hideaway-gdm", hidden, () => Store.setChannelHidden(channel.id, !hidden)));
};

export default definePlugin({
    name: "Hideaway",
    description: "Hide servers and DMs behind a passcode. Right-click the Discover button to unlock or lock",
    authors: [{ name: "mystic", id: 0n }],
    settings,

    patches: [
        {
            find: '("guildsnav")',
            replacement: [
                // Take hidden servers out of the server list (and out of their folders)
                {
                    match: /(?<==)\i\.getRoots\(\)/,
                    replace: "$self.useFilteredRoots($&)"
                },
                // While unlocked, list the hidden servers right under the Discover button
                {
                    match: /(?<=lastTargetNode:\i\[\i\.length-1\]\}\),)(\i)\?null:\i(?=,)/,
                    replace: "$&,$1?null:$self.renderSection(arguments[0])"
                }
            ]
        },
        {
            // Discord's "should this message notify" check
            find: ".SUPPRESS_NOTIFICATIONS))return!1",
            replacement: {
                match: /\.SUPPRESS_NOTIFICATIONS\)\)return!1;/,
                replace: "$&if($self.shouldMute(arguments[1]))return!1;"
            }
        }
    ],

    contextMenus: {
        "guild-context": guildContextPatch,
        "user-context": userContextPatch,
        "gdm-context": groupDmContextPatch
    },

    flux: {
        // Opening a hidden DM or server while locked (friends list, links, mentions) bounces back home
        CHANNEL_SELECT({ guildId, channelId }: { guildId?: string | null; channelId?: string | null; }) {
            if (!running || !Store.isLoaded() || Store.isUnlocked()) return;
            if (Store.isGuildConcealed(guildId) || Store.isChannelConcealed(channelId)) {
                setTimeout(leaveIfConcealed, 0);
            }
        }
    },

    useFilteredRoots(roots: any[]) {
        useHideawayVersion();
        return filterRoots(roots);
    },

    renderSection(props: any) {
        return running ? renderSection(props) : null;
    },

    shouldMute(channelId: string) {
        try {
            return running && settings.store.muteWhileLocked && Store.isChannelConcealed(channelId);
        } catch (err) {
            logger.error(err);
            return false;
        }
    },

    start() {
        running = true;
        lastActivity = Date.now();

        channelStores = [
            filterIdMethod(PrivateChannelSortStore, "getPrivateChannelIds"),
            filterIdMethod(findStore("PrivateChannelReadStateStore"), "getUnreadPrivateChannelIds")
        ].filter(Boolean);

        cleanups.push(Store.subscribe(refreshChannelStores));
        cleanups.push(Store.onLock(leaveIfConcealed));

        document.addEventListener("contextmenu", onContextMenu, true);
        window.addEventListener("blur", onBlur);
        for (const type of ["mousedown", "mousemove", "keydown", "wheel"]) {
            window.addEventListener(type, onActivity, { passive: true, capture: true });
        }
        idleTimer = setInterval(checkIdle, IDLE_CHECK_MS);

        Store.load()
            .then(leaveIfConcealed)
            .catch(err => logger.error("Failed to load, everything stays hidden", err));
    },

    stop() {
        running = false;
        document.removeEventListener("contextmenu", onContextMenu, true);
        window.removeEventListener("blur", onBlur);
        for (const type of ["mousedown", "mousemove", "keydown", "wheel"]) {
            window.removeEventListener(type, onActivity, { capture: true });
        }
        if (idleTimer) clearInterval(idleTimer);
        idleTimer = null;

        while (cleanups.length) cleanups.pop()!();
        channelStores = [];
        Store.reset();
    }
});
