/*
 * ReactionNotifier - Vencord plugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Discord desktop only flashes the taskbar when someone reacts to your
 * message, without saying who, what or where. This shows an in-app toast
 * instead. Toasts don't count down while Discord is in the background, so
 * one waits for you until you come back.
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import {
    ChannelStore,
    createRoot,
    GuildMemberStore,
    GuildStore,
    IconUtils,
    MessageStore,
    NavigationRouter,
    RelationshipStore,
    SelectedChannelStore,
    UserGuildSettingsStore,
    UserStore,
    UserUtils,
    WindowStore
} from "@webpack/common";
import type { Root } from "react-dom/client";

const settings = definePluginSettings({
    showWhen: {
        type: OptionType.SELECT,
        description: "When to show a toast",
        options: [
            { label: "Unless I'm looking at that channel", value: "notViewing", default: true },
            { label: "Only while Discord is in the background", value: "unfocused" },
            { label: "Always", value: "always" }
        ]
    },
    durationSeconds: {
        type: OptionType.SLIDER,
        description: "How long a toast stays once you're back in Discord (0 keeps it until you close it). The timer pauses while Discord is in the background or you hover a toast.",
        default: 10,
        markers: [0, 5, 10, 15, 20, 30, 60],
        stickToMarkers: true,
        componentProps: {
            onValueRender: (v: number) => v === 0 ? "Until closed" : `${v} s`
        }
    },
    position: {
        type: OptionType.SELECT,
        description: "Where toasts appear",
        options: [
            { label: "Bottom right", value: "bottom-right", default: true },
            { label: "Top right", value: "top-right" },
            { label: "Bottom left", value: "bottom-left" }
        ],
        onChange: () => render()
    },
    ignoreMuted: {
        type: OptionType.BOOLEAN,
        description: "Skip reactions in muted servers and channels",
        default: false
    },
    dmsOnly: {
        type: OptionType.BOOLEAN,
        description: "Only notify for reactions in DMs and group DMs",
        default: false
    }
});

const MAX_VISIBLE = 4;
const TICK_MS = 100;
const PREVIEW_CHARS = 120;

interface ReactionEmoji {
    id?: string | null;
    name: string;
    animated?: boolean;
}

interface ReactionAddEvent {
    channelId: string;
    messageId: string;
    userId: string;
    emoji: ReactionEmoji;
    messageAuthorId?: string;
    burst?: boolean;
    reactionType?: number;
    optimistic?: boolean;
}

interface Reactor {
    userId: string;
    emojiKey: string;
}

interface Toast {
    /** messageId: reactions on the same message share one toast */
    key: string;
    channelId: string;
    guildId: string | null;
    messageId: string;
    reactors: Reactor[];
    emojis: Map<string, ReactionEmoji>;
    burst: boolean;
    location: string;
    preview: string | undefined;
    /** ms left on screen once Discord is focused; Infinity = until closed */
    remaining: number;
    total: number;
}

let toasts: Toast[] = [];
let hovered = false;
let host: HTMLDivElement | null = null;
let root: Root | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const emojiKey = (e: ReactionEmoji) => e.id ?? e.name;

function isFocused() {
    try {
        return WindowStore?.isFocused?.() ?? document.hasFocus();
    } catch {
        return document.hasFocus();
    }
}

function displayName(userId: string, guildId: string | null) {
    const user = UserStore.getUser(userId);
    return (guildId && GuildMemberStore.getNick(guildId, userId))
        || RelationshipStore.getNickname(userId)
        || user?.globalName
        || user?.username
        || "Someone";
}

function avatarUrl(userId: string) {
    const user = UserStore.getUser(userId);
    return user ? IconUtils.getUserAvatarURL(user, false, 40) : undefined;
}

function describeLocation(channelId: string): { location: string; guildId: string | null; } {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return { location: "Unknown channel", guildId: null };
    if (channel.isDM()) return { location: "Direct message", guildId: null };
    if (channel.isGroupDM()) return { location: channel.name || "Group DM", guildId: null };
    const guild = GuildStore.getGuild(channel.guild_id);
    return {
        location: guild ? `#${channel.name} · ${guild.name}` : `#${channel.name}`,
        guildId: channel.guild_id
    };
}

function messagePreview(channelId: string, messageId: string) {
    const msg = MessageStore.getMessage(channelId, messageId);
    if (!msg) return undefined;
    const text = msg.content?.trim();
    if (text) return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
    if (msg.attachments?.length) return "Attachment";
    if (msg.stickerItems?.length) return "Sticker";
    if (msg.embeds?.length) return "Embed";
    return undefined;
}

function shouldNotify(e: ReactionAddEvent) {
    const me = UserStore.getCurrentUser()?.id;
    if (!me || e.userId === me) return false;

    const author = e.messageAuthorId ?? MessageStore.getMessage(e.channelId, e.messageId)?.author?.id;
    if (author !== me) return false;
    if (RelationshipStore.isBlocked(e.userId)) return false;

    const channel = ChannelStore.getChannel(e.channelId);
    const isPrivate = channel?.isPrivate() ?? false;
    if (settings.store.dmsOnly && !isPrivate) return false;
    if (settings.store.ignoreMuted && channel?.guild_id
        && UserGuildSettingsStore.isGuildOrCategoryOrChannelMuted(channel.guild_id, e.channelId)) return false;

    const focused = isFocused();
    switch (settings.store.showWhen) {
        case "unfocused":
            return !focused;
        case "always":
            return true;
        default:
            return !focused || SelectedChannelStore.getChannelId() !== e.channelId;
    }
}

function durationMs() {
    const s = settings.store.durationSeconds;
    return s > 0 ? s * 1000 : Infinity;
}

function onReactionAdd(e: ReactionAddEvent) {
    if (!e?.emoji || !shouldNotify(e)) return;

    const key = emojiKey(e.emoji);
    const burst = !!e.burst || e.reactionType === 1;
    let toast = toasts.find(t => t.key === e.messageId);

    if (toast) {
        // Move to the newest slot and restart its timer
        toasts = toasts.filter(t => t !== toast);
        toast.reactors = toast.reactors.filter(r => !(r.userId === e.userId && r.emojiKey === key));
    } else {
        const { location, guildId } = describeLocation(e.channelId);
        toast = {
            key: e.messageId,
            channelId: e.channelId,
            guildId,
            messageId: e.messageId,
            reactors: [],
            emojis: new Map(),
            burst: false,
            location,
            preview: messagePreview(e.channelId, e.messageId),
            remaining: 0,
            total: 0
        };
    }

    toast.reactors.push({ userId: e.userId, emojiKey: key });
    toast.emojis.set(key, e.emoji);
    toast.burst ||= burst;
    toast.total = toast.remaining = durationMs();
    toasts.push(toast);

    // Reactors in big servers often aren't cached yet
    if (!UserStore.getUser(e.userId)) {
        UserUtils.getUser(e.userId).then(render).catch(() => { });
    }

    render();
    ensureTimer();
}

function onReactionRemove(e: ReactionAddEvent) {
    const toast = toasts.find(t => t.key === e.messageId);
    if (!toast || !e?.emoji) return;
    const key = emojiKey(e.emoji);
    toast.reactors = toast.reactors.filter(r => !(r.userId === e.userId && r.emojiKey === key));
    if (!toast.reactors.some(r => r.emojiKey === key)) toast.emojis.delete(key);
    if (!toast.reactors.length) toasts = toasts.filter(t => t !== toast);
    render();
}

function dismiss(toast: Toast) {
    toasts = toasts.filter(t => t !== toast);
    if (!toasts.length) hovered = false;
    render();
}

function clearAll() {
    toasts = [];
    hovered = false;
    render();
}

function jumpTo(toast: Toast) {
    dismiss(toast);
    NavigationRouter.transitionTo(`/channels/${toast.guildId ?? "@me"}/${toast.channelId}/${toast.messageId}`);
}

function ensureTimer() {
    if (timer) return;
    timer = setInterval(() => {
        if (!toasts.length) {
            clearInterval(timer!);
            timer = null;
            return;
        }
        // Only count down while you can actually see the toast
        if (hovered || !isFocused()) return;

        let changed = false;
        for (const t of toasts) {
            if (!Number.isFinite(t.remaining)) continue;
            t.remaining -= TICK_MS;
            changed = true;
        }
        const before = toasts.length;
        toasts = toasts.filter(t => t.remaining > 0);
        if (changed || toasts.length !== before) render();
    }, TICK_MS);
}

function Emoji({ emoji }: { emoji: ReactionEmoji; }) {
    if (emoji.id) {
        return (
            <img
                className="vc-rn-emoji"
                src={IconUtils.getEmojiURL({ id: emoji.id, animated: !!emoji.animated, size: 48 })}
                alt={`:${emoji.name}:`}
                title={`:${emoji.name}:`}
            />
        );
    }
    return <span className="vc-rn-emoji vc-rn-emoji-text">{emoji.name}</span>;
}

function CloseIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="currentColor"
                d="M17.3 18.7a1 1 0 0 0 1.4-1.4L13.42 12l5.3-5.3a1 1 0 0 0-1.42-1.4L12 10.58l-5.3-5.3a1 1 0 0 0-1.4 1.42L10.58 12l-5.3 5.3a1 1 0 1 0 1.42 1.4L12 13.42l5.3 5.3Z"
            />
        </svg>
    );
}

function headline(toast: Toast) {
    const ids = [...new Set(toast.reactors.map(r => r.userId))].reverse();
    const names = ids.map(id => displayName(id, toast.guildId));
    const who = names.length === 1 ? names[0]
        : names.length === 2 ? `${names[0]} and ${names[1]}`
            : `${names[0]} and ${names.length - 1} others`;
    return { who, latest: ids[0], verb: toast.burst ? "super reacted" : "reacted" };
}

function ToastCard({ toast }: { toast: Toast; }) {
    const { who, latest, verb } = headline(toast);
    const avatar = avatarUrl(latest);
    const progress = Number.isFinite(toast.total) ? Math.max(0, toast.remaining / toast.total) : null;
    const waiting = !isFocused();

    return (
        <div
            className="vc-rn-toast"
            role="button"
            tabIndex={0}
            onClick={() => jumpTo(toast)}
            onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") jumpTo(toast);
            }}
        >
            {avatar ? <img className="vc-rn-avatar" src={avatar} alt="" /> : <div className="vc-rn-avatar" />}
            <div className="vc-rn-body">
                <div className="vc-rn-headline">
                    <span className="vc-rn-who">{who}</span>
                    <span className="vc-rn-verb">{verb}</span>
                    <span className="vc-rn-emojis">
                        {[...toast.emojis.values()].map(e => <Emoji key={emojiKey(e)} emoji={e} />)}
                    </span>
                </div>
                <div className="vc-rn-location">{toast.location}</div>
                {toast.preview && <div className="vc-rn-preview">{toast.preview}</div>}
            </div>
            <button
                className="vc-rn-close"
                aria-label="Dismiss"
                onClick={e => {
                    e.stopPropagation();
                    dismiss(toast);
                }}
            >
                <CloseIcon />
            </button>
            {progress != null && (
                <div className={`vc-rn-progress${waiting ? " vc-rn-waiting" : ""}`} style={{ width: `${progress * 100}%` }} />
            )}
        </div>
    );
}

function ToastStack() {
    const visible = toasts.slice(-MAX_VISIBLE).reverse();
    const hidden = toasts.length - visible.length;

    return (
        <div
            className={`vc-rn-stack vc-rn-${settings.store.position}`}
            onMouseEnter={() => { hovered = true; }}
            onMouseLeave={() => { hovered = false; }}
        >
            {visible.map(t => <ToastCard key={t.key} toast={t} />)}
            {toasts.length > 1 && (
                <div className="vc-rn-footer">
                    {hidden > 0 && <span>+{hidden} more</span>}
                    <button className="vc-rn-clear" onClick={clearAll}>Clear all</button>
                </div>
            )}
        </div>
    );
}

function render() {
    if (!toasts.length) {
        root?.render(null);
        return;
    }
    if (!host || !root) {
        host = document.createElement("div");
        host.className = "vc-rn-host";
        // Inside #app-mount like Discord's own layers, so theme variables apply
        (document.getElementById("app-mount") ?? document.body).appendChild(host);
        root = createRoot(host);
    }
    root.render(
        <ErrorBoundary noop>
            <ToastStack />
        </ErrorBoundary>
    );
}

/** Repaint when focus changes, so the "waiting" state and timer update. */
const onFocusChange = () => {
    if (toasts.length) render();
};

export default definePlugin({
    name: "ReactionNotifier",
    description: "Shows an in-app toast when someone reacts to your message: who, which emoji, and where",
    authors: [{ name: "mystic", id: 0n }],
    settings,

    flux: {
        MESSAGE_REACTION_ADD(e: ReactionAddEvent) {
            try {
                onReactionAdd(e);
            } catch (err) {
                console.error("[ReactionNotifier]", err);
            }
        },
        MESSAGE_REACTION_REMOVE(e: ReactionAddEvent) {
            try {
                onReactionRemove(e);
            } catch (err) {
                console.error("[ReactionNotifier]", err);
            }
        }
    },

    start() {
        window.addEventListener("focus", onFocusChange);
        window.addEventListener("blur", onFocusChange);
    },

    stop() {
        window.removeEventListener("focus", onFocusChange);
        window.removeEventListener("blur", onFocusChange);
        if (timer) clearInterval(timer);
        timer = null;
        toasts = [];
        hovered = false;
        root?.unmount();
        host?.remove();
        root = null;
        host = null;
    }
});
