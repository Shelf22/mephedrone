/*
 * BestMessageLogger, a Vencord plugin by Kh8da
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { ChannelStore, GuildMemberStore, GuildStore, Parser, SelectedChannelStore, UserStore } from "@webpack/common";

import type { LogMessage } from "./types";

export const logger = new Logger("BestMessageLogger", "#e0525b");

const CDN = "https://cdn.discordapp.com";

export function escapeHtml(text: unknown): string {
    return String(text ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#39;");
}

/** Only allow http(s) and blob links into generated HTML. */
export function safeUrl(url: unknown): string {
    const s = String(url ?? "").trim();
    return /^(https?:|blob:)/i.test(s) ? s : "";
}

const DISCORD_MEDIA_HOST = /^(cdn\.discordapp\.com|media\.discordapp\.net|images-ext-\d+\.discordapp\.net)$/i;

/**
 * Picks the first url that Discord itself serves (or a local blob). Media is never loaded
 * straight from third party sites, so they can't see your IP address.
 */
export function discordMediaUrl(...urls: Array<string | null | undefined>): string {
    for (const url of urls) {
        if (!url) continue;
        if (url.startsWith("blob:")) return url;
        try {
            const parsed = new URL(url);
            if (parsed.protocol === "https:" && DISCORD_MEDIA_HOST.test(parsed.hostname)) return url;
        } catch { }
    }
    return "";
}

export function toIso(value: unknown): string | null {
    if (value == null || value === "") return null;
    if (typeof value === "string") return value;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    // moment objects and anything else with toISOString / valueOf
    const anyValue = value as any;
    if (typeof anyValue.toISOString === "function") {
        try { return anyValue.toISOString(); } catch { return null; }
    }
    const n = Number(anyValue.valueOf?.());
    return Number.isFinite(n) ? new Date(n).toISOString() : null;
}

export function snowflakeTime(id: string): number {
    try {
        return Number((BigInt(id) >> 22n) + 1420070400000n);
    } catch {
        return 0;
    }
}

export function compareSnowflakes(a: string, b: string): number {
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : a > b ? 1 : 0;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const fullFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "medium" });
const timeFormatter = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

export function formatDate(iso?: string | null, full = false): string {
    if (!iso) return "Unknown time";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return (full ? fullFormatter : dateFormatter).format(d);
}

/** Short time for list cards: "14:03" today, "Yesterday", or a date. */
export function formatShort(iso?: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const t = d.getTime();
    if (t >= startOfToday) return timeFormatter.format(d);
    if (t >= startOfToday - 86400000) return `Yesterday ${timeFormatter.format(d)}`;
    return dateFormatter.format(d);
}

export function formatBytes(bytes: number): string {
    if (!bytes) return "";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function userAvatarUrl(id: string | null | undefined, avatar: string | null | undefined, discriminator?: string | null): string {
    if (id && avatar) {
        return `${CDN}/avatars/${id}/${avatar}.webp?size=64`;
    }
    let index = 0;
    try {
        if (discriminator && discriminator !== "0") index = Number(discriminator) % 5;
        else if (id) index = Number((BigInt(id) >> 22n) % 6n);
    } catch { }
    return `${CDN}/embed/avatars/${index}.png`;
}

export function guildIconUrl(id: string | null | undefined, icon: string | null | undefined): string | null {
    if (!id || !icon) return null;
    return `${CDN}/icons/${id}/${icon}.webp?size=64`;
}

export function emojiUrl(id: string, animated: boolean): string {
    return `${CDN}/emojis/${id}.${animated ? "gif" : "webp"}?size=48&quality=lossless`;
}

export function initials(name: string): string {
    return name
        .replace(/'s /g, " ")
        .replace(/\w+/g, w => w[0])
        .replace(/\s/g, "")
        .slice(0, 3) || "?";
}

export function getGuildInfo(guildId: string | null, fallbackName?: string | null, fallbackIcon?: string | null) {
    if (!guildId) return null;
    let guild: any = null;
    try { guild = GuildStore.getGuild(guildId); } catch { }
    const name = guild?.name || fallbackName || "Unknown server";
    return {
        id: guildId,
        name,
        iconUrl: guild ? guildIconUrl(guildId, guild.icon) : (fallbackIcon ?? null),
        acronym: initials(name)
    };
}

function userDisplayName(userId: string, guildId?: string | null): string | null {
    try {
        if (guildId) {
            const nick = GuildMemberStore.getNick(guildId, userId);
            if (nick) return nick;
        }
        const user: any = UserStore.getUser(userId);
        if (user) return user.globalName || user.global_name || user.username;
    } catch { }
    return null;
}

export function resolveUserName(userId: string, guildId: string | null, captured?: Record<string, string>): string {
    return userDisplayName(userId, guildId) || captured?.[userId] || "unknown-user";
}

/** A readable place name: "#general" in servers, "@name" in DMs, the group name in group DMs. */
export function getChannelLabel(channelId: string, fallback?: string | null): string {
    let channel: any = null;
    try { channel = ChannelStore.getChannel(channelId); } catch { }
    if (!channel) return fallback || "unknown-channel";

    if (channel.isDM?.()) {
        const recipientId = channel.recipients?.[0] ?? channel.getRecipientId?.();
        const name = recipientId ? userDisplayName(recipientId) : null;
        return name ? `@${name}` : (fallback || "Direct Message");
    }
    if (channel.isGroupDM?.()) {
        if (channel.name) return channel.name;
        const names = (channel.recipients ?? []).map((id: string) => userDisplayName(id)).filter(Boolean);
        return names.length ? names.join(", ") : (fallback || "Group DM");
    }
    return channel.name ? `#${channel.name}` : (fallback || "unknown-channel");
}

export function isDmMessage(message: LogMessage): boolean {
    if (message.guildId) return false;
    try {
        return !ChannelStore.getChannel(message.channelId)?.guild_id;
    } catch {
        return true;
    }
}

export function messageLink(message: LogMessage): string {
    return `/channels/${message.guildId ?? "@me"}/${message.channelId}/${message.id}`;
}

export function parseEditContent(content: string, message: any) {
    return Parser.parse(content, true, {
        channelId: message.channel_id,
        messageId: message.id,
        allowLinks: true,
        allowHeading: true,
        allowList: true,
        allowEmojiLinks: true,
        viewingChannelId: SelectedChannelStore.getChannelId(),
    });
}
