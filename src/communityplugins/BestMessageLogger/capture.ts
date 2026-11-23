/*
 * BestMessageLogger, a Vencord plugin by Kh8da
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelStore, GuildMemberStore, GuildStore, UserStore } from "@webpack/common";

import { parseIdList, settings } from "./settings";
import type { LogEmbed, LogMedia, LogMessage, MediaKind, RawMessage } from "./types";
import { getChannelLabel, guildIconUrl, toIso, userAvatarUrl } from "./utils";

const EPHEMERAL = 1 << 6;
const IS_VOICE_MESSAGE = 1 << 13;
const RAW_CACHE_LIMIT = 6000;

/**
 * Raw API copies of messages seen this session, keyed by message id.
 * Used to log deletes in channels that are not open and to keep the full original shape.
 */
const rawCache = new Map<string, RawMessage>();

export function cacheRaw(message: any) {
    if (!message?.id || !message.channel_id || message.__bml) return;
    const id = String(message.id);
    const prev = rawCache.get(id);
    if (prev) rawCache.delete(id);
    rawCache.set(id, prev ? { ...prev, ...stripRaw(message) } : stripRaw(message));
    if (rawCache.size > RAW_CACHE_LIMIT) {
        // Maps keep insertion order, so the first keys are the oldest
        let toDrop = rawCache.size - RAW_CACHE_LIMIT;
        for (const key of rawCache.keys()) {
            rawCache.delete(key);
            if (--toDrop <= 0) break;
        }
    }
}

/*
 * Discord stamps messages with server time, but delete events carry no time at all, so the
 * delete time comes from this computer's clock. A clock that runs behind made messages look
 * deleted before they were sent. New messages tell us roughly how far off the clock is.
 */
const clockSamples: number[] = [];
const MAX_CLOCK_OFFSET = 10 * 60 * 1000;

export function noteServerTime(timestamp: unknown) {
    const t = typeof timestamp === "string" ? Date.parse(timestamp) : NaN;
    if (!Number.isFinite(t)) return;
    const offset = t - Date.now();
    if (Math.abs(offset) > MAX_CLOCK_OFFSET) return;
    clockSamples.push(offset);
    if (clockSamples.length > 25) clockSamples.shift();
}

/** The current time as Discord's servers see it, never earlier than the given times. */
export function serverNowIso(...notBefore: Array<string | null | undefined>): string {
    // a message arrives after it was stamped, so the largest offset is the closest to the real one
    const offset = clockSamples.length ? Math.max(...clockSamples) : 0;
    let time = Date.now() + Math.max(0, offset);
    for (const iso of notBefore) {
        const t = iso ? Date.parse(iso) : NaN;
        if (Number.isFinite(t) && t > time) time = t;
    }
    return new Date(time).toISOString();
}

export function getCachedRaw(id: string): RawMessage | undefined {
    return rawCache.get(String(id));
}

export function forgetRaw(id: string) {
    rawCache.delete(String(id));
}

export function clearRawCache() {
    rawCache.clear();
}

/** Drops fields that are big or useless for logging. */
function stripRaw(message: any): RawMessage {
    const { referenced_message, interaction_metadata, ...rest } = message;
    const out: any = { ...rest };
    if (referenced_message && typeof referenced_message === "object") {
        const { referenced_message: _nested, ...ref } = referenced_message;
        out.referenced_message = ref;
    }
    return out;
}

/** True when the object is an API message, not one of Discord's MessageRecord objects. */
export function looksLikeApiMessage(message: any): boolean {
    return message != null
        && typeof message.timestamp === "string"
        && ("mention_everyone" in message || "edited_timestamp" in message);
}

function userToRaw(user: any): Record<string, any> | null {
    if (!user?.id) return null;
    return {
        id: String(user.id),
        username: user.username ?? "unknown",
        global_name: user.global_name ?? user.globalName ?? null,
        avatar: user.avatar ?? null,
        discriminator: user.discriminator ?? "0",
        bot: !!user.bot,
        public_flags: user.public_flags ?? user.publicFlags ?? 0
    };
}

function colorToInt(color: unknown): number | undefined {
    if (typeof color === "number") return color;
    if (typeof color === "string" && /^#?[0-9a-f]{6}$/i.test(color)) return parseInt(color.replace("#", ""), 16);
    return undefined;
}

function mediaToRaw(media: any) {
    if (!media) return undefined;
    const { url } = media;
    if (!url) return undefined;
    return {
        url,
        proxy_url: media.proxy_url ?? media.proxyURL ?? media.proxyUrl,
        width: media.width,
        height: media.height,
        content_type: media.content_type ?? media.contentType
    };
}

/** Converts an embed from either the API shape or Discord's internal record shape to the API shape. */
function embedToRaw(embed: any): Record<string, any> {
    if (!embed || typeof embed !== "object") return {};
    const isRecord = "rawTitle" in embed || "rawDescription" in embed;
    if (!isRecord) return embed;
    return {
        type: embed.type,
        url: embed.url,
        title: embed.rawTitle,
        description: embed.rawDescription,
        color: colorToInt(embed.color),
        timestamp: toIso(embed.timestamp) ?? undefined,
        author: embed.author ? { name: embed.author.name, url: embed.author.url, icon_url: embed.author.iconURL, proxy_icon_url: embed.author.iconProxyURL } : undefined,
        footer: embed.footer ? { text: embed.footer.text, icon_url: embed.footer.iconURL, proxy_icon_url: embed.footer.iconProxyURL } : undefined,
        provider: embed.provider ? { name: embed.provider.name, url: embed.provider.url } : undefined,
        fields: Array.isArray(embed.fields) ? embed.fields.map((f: any) => ({ name: f.rawName ?? f.name ?? "", value: f.rawValue ?? f.value ?? "", inline: !!f.inline })) : undefined,
        image: mediaToRaw(embed.image),
        thumbnail: mediaToRaw(embed.thumbnail),
        video: mediaToRaw(embed.video)
    };
}

function attachmentToRaw(a: any) {
    return {
        id: String(a.id ?? ""),
        filename: a.filename ?? "attachment",
        size: a.size ?? 0,
        url: a.url ?? "",
        proxy_url: a.proxy_url ?? a.proxyURL ?? a.url ?? "",
        content_type: a.content_type ?? a.contentType,
        width: a.width,
        height: a.height,
        flags: a.flags,
        duration_secs: a.duration_secs ?? a.durationSecs,
        waveform: a.waveform,
        description: a.description,
        spoiler: a.spoiler
    };
}

/**
 * Turns an API message or a MessageRecord into a plain API shaped object that is safe to store.
 * Components and snapshots are kept as they are; {@link sanitizeForChat} decides what goes back into chat.
 */
export function toRaw(message: any): RawMessage {
    if (looksLikeApiMessage(message)) return JSON.parse(JSON.stringify(stripRaw(message)));

    const author = userToRaw(message.author) ?? { id: null, username: "Unknown User", global_name: null, avatar: null, discriminator: "0", bot: false };
    const mentions = (Array.isArray(message.mentions) ? message.mentions : [])
        .map((m: any) => typeof m === "string" ? (userToRaw(UserStore.getUser(m)) ?? { id: m, username: "unknown-user", global_name: null }) : userToRaw(m))
        .filter(Boolean);
    const ref = message.messageReference ?? message.message_reference;

    const raw: RawMessage = {
        id: String(message.id),
        channel_id: String(message.channel_id ?? message.channelId),
        guild_id: message.guild_id ?? undefined,
        type: typeof message.type === "number" ? message.type : 0,
        content: message.content ?? "",
        author,
        timestamp: toIso(message.timestamp) ?? new Date().toISOString(),
        edited_timestamp: toIso(message.edited_timestamp ?? message.editedTimestamp),
        mentions,
        mention_roles: [...(message.mention_roles ?? message.mentionRoles ?? [])],
        mention_everyone: !!(message.mention_everyone ?? message.mentionEveryone),
        attachments: (message.attachments ?? []).map(attachmentToRaw),
        embeds: (message.embeds ?? []).map(embedToRaw),
        sticker_items: (message.sticker_items ?? message.stickerItems ?? []).map((s: any) => ({ id: String(s.id), name: s.name, format_type: s.format_type ?? s.formatType })),
        flags: message.flags ?? 0,
        pinned: !!message.pinned,
        tts: false,
        components: message.components ?? [],
        message_snapshots: (message.message_snapshots ?? message.messageSnapshots ?? []).map((s: any) => ({ message: s?.message ? toRaw({ id: message.id, channel_id: message.channel_id, ...s.message, author: s.message.author ?? message.author }) : {} })),
        poll: message.poll
    };

    if (ref) {
        raw.message_reference = {
            type: ref.type,
            message_id: ref.message_id ?? ref.messageId,
            channel_id: ref.channel_id ?? ref.channelId,
            guild_id: ref.guild_id ?? ref.guildId
        };
    }

    return JSON.parse(JSON.stringify(raw, (_key, value) => typeof value === "bigint" ? String(value) : value));
}

/**
 * Prepares a stored message for Discord's message loader. Parts that came from Discord's
 * internal objects instead of the API are dropped, because the loader expects the API shape.
 */
export function sanitizeForChat(raw: RawMessage, fromApi: boolean): RawMessage {
    const out: RawMessage = JSON.parse(JSON.stringify(raw));
    out.deleted = true;
    out.__bml = true;
    out.attachments = (out.attachments ?? []).map((a: any) => ({ ...a, deleted: true }));
    delete out.referenced_message;
    if (!fromApi) {
        out.components = [];
        out.message_snapshots = [];
        delete out.poll;
        delete out.interaction;
        delete out.interaction_metadata;
    }
    return out;
}

export function isEphemeral(message: any) {
    return ((message?.flags ?? 0) & EPHEMERAL) === EPHEMERAL;
}

export function shouldIgnore(message: any, isEdit = false): boolean {
    try {
        const s = settings.store;
        const myId = UserStore.getCurrentUser()?.id;
        const channelId = String(message.channel_id ?? message.channelId ?? "");
        const channel: any = ChannelStore.getChannel(channelId);
        const authorId = message.author?.id ? String(message.author.id) : "";

        return (isEdit ? !s.logEdits : !s.logDeletes)
            || (s.ignoreBots && !!message.author?.bot)
            || (s.ignoreSelf && !!myId && authorId === myId)
            || parseIdList(s.ignoreUsers).includes(authorId)
            || parseIdList(s.ignoreChannels).some(id => id === channelId || id === channel?.parent_id)
            || parseIdList(s.ignoreGuilds).includes(String(message.guild_id ?? channel?.guild_id ?? ""));
    } catch {
        return false;
    }
}

/** True when the message pinged the current user (direct mention, @everyone or one of their roles). */
export function pingsMe(raw: RawMessage): boolean {
    try {
        const myId = UserStore.getCurrentUser()?.id;
        if (!myId || String(raw.author?.id) === myId) return false;
        if (raw.mention_everyone) return true;
        if ((raw.mentions ?? []).some((m: any) => String(typeof m === "string" ? m : m?.id) === myId)) return true;
        const roles: string[] = raw.mention_roles ?? [];
        if (!roles.length) return false;
        const guildId = raw.guild_id ?? ChannelStore.getChannel(raw.channel_id)?.guild_id;
        if (!guildId) return false;
        const myRoles: string[] = (GuildMemberStore.getMember(guildId, myId) as any)?.roles ?? [];
        return roles.some(r => myRoles.includes(String(r)));
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Raw message -> log message
// ---------------------------------------------------------------------------

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp)(\?|$)/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|$)/i;
const AUDIO_EXT = /\.(mp3|ogg|oga|wav|flac|m4a|aac|opus)(\?|$)/i;

function kindOf(contentType: string, filename: string, url: string): MediaKind {
    const type = (contentType || "").toLowerCase();
    if (type.startsWith("image/")) return "image";
    if (type.startsWith("video/")) return "video";
    if (type.startsWith("audio/")) return "audio";
    const name = `${filename} ${url}`;
    if (IMAGE_EXT.test(filename) || (!filename && IMAGE_EXT.test(url))) return "image";
    if (VIDEO_EXT.test(filename) || (!filename && VIDEO_EXT.test(url))) return "video";
    if (AUDIO_EXT.test(filename) || (!filename && AUDIO_EXT.test(name))) return "audio";
    return "file";
}

function filenameFromUrl(url: string): string {
    try {
        const last = new URL(url).pathname.split("/").pop();
        return last ? decodeURIComponent(last) : "file";
    } catch {
        return "file";
    }
}

function collectAttachments(raw: any, media: LogMedia[], source: LogMedia["source"], prefix: string) {
    (raw.attachments ?? []).forEach((a: any, i: number) => {
        const url = a.url || a.proxy_url || "";
        if (!url) return;
        const filename = a.filename || filenameFromUrl(url);
        const isVoice = ((raw.flags ?? 0) & IS_VOICE_MESSAGE) === IS_VOICE_MESSAGE;
        media.push({
            key: `${prefix}att-${a.id || i}`,
            kind: isVoice ? "audio" : kindOf(a.content_type, filename, url),
            url,
            proxyUrl: a.proxy_url || url,
            filename,
            contentType: a.content_type || "",
            size: a.size || 0,
            width: a.width,
            height: a.height,
            spoiler: !!a.spoiler || filename.startsWith("SPOILER_"),
            source
        });
    });
}

function collectStickers(raw: any, media: LogMedia[], extraText: string[]) {
    for (const s of raw.sticker_items ?? []) {
        // 1 png, 2 apng, 3 lottie, 4 gif
        if (s.format_type === 3) {
            extraText.push(`Sticker: ${s.name}`);
            continue;
        }
        const ext = s.format_type === 4 ? "gif" : "png";
        const url = `https://media.discordapp.net/stickers/${s.id}.${ext}?size=160`;
        media.push({ key: `sticker-${s.id}`, kind: "image", url, proxyUrl: url, filename: s.name || "sticker", contentType: `image/${ext}`, size: 0, source: "sticker" });
    }
}

function textOf(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function collectEmbeds(raw: any, media: LogMedia[], prefix: string): LogEmbed[] {
    const embeds: LogEmbed[] = [];
    (raw.embeds ?? []).forEach((e: any, i: number) => {
        if (!e || typeof e !== "object") return;
        const type = e.type || "rich";
        const image = e.image?.proxy_url || e.image?.url || "";
        const thumb = e.thumbnail?.proxy_url || e.thumbnail?.url || "";
        const video = e.video?.proxy_url || "";

        // Media-only embeds (links to images, gifs and videos) are shown as plain media
        if (type === "gifv" && video) {
            media.push({ key: `${prefix}emb-${i}`, kind: "video", url: e.video.url || video, proxyUrl: video, filename: filenameFromUrl(e.url || video), contentType: "video/mp4", size: 0, width: e.video?.width, height: e.video?.height, gifv: true, source: "embed" });
            return;
        }
        if (type === "image" && (thumb || image)) {
            const src = image || thumb;
            media.push({ key: `${prefix}emb-${i}`, kind: "image", url: e.url || src, proxyUrl: src, filename: filenameFromUrl(e.url || src), contentType: "", size: 0, width: e.thumbnail?.width, height: e.thumbnail?.height, source: "embed" });
            return;
        }
        if (type === "video" && video && !e.provider) {
            media.push({ key: `${prefix}emb-${i}`, kind: "video", url: e.video.url || video, proxyUrl: video, filename: filenameFromUrl(e.url || video), contentType: "video/mp4", size: 0, source: "embed" });
            return;
        }

        const color = typeof e.color === "number" ? `#${e.color.toString(16).padStart(6, "0")}` : (typeof e.color === "string" ? e.color : null);
        embeds.push({
            color,
            title: textOf(e.title),
            url: textOf(e.url),
            description: textOf(e.description),
            authorName: textOf(e.author?.name),
            authorIcon: textOf(e.author?.proxy_icon_url || e.author?.icon_url),
            providerName: textOf(e.provider?.name),
            footerText: textOf(e.footer?.text),
            fields: Array.isArray(e.fields) ? e.fields.map((f: any) => ({ name: textOf(f.name), value: textOf(f.value), inline: !!f.inline })) : [],
            thumbnail: thumb,
            image
        });
    });
    return embeds;
}

/** Walks components v2 (containers, sections, text displays, media galleries, files). */
function collectComponents(nodes: any, media: LogMedia[], extraText: string[], prefix: string, depth = 0) {
    if (!Array.isArray(nodes) || depth > 6) return;
    for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        if (typeof node.content === "string" && node.content.trim()) extraText.push(node.content);

        const pushMedia = (m: any, spoiler?: boolean) => {
            const url = m?.url || m?.proxy_url || m?.proxyUrl || m?.proxyURL;
            if (!url || /^attachment:\/\//.test(url)) return;
            const proxyUrl = m.proxy_url || m.proxyUrl || m.proxyURL || url;
            const contentType = m.content_type || m.contentType || "";
            const filename = m.filename || filenameFromUrl(url);
            media.push({ key: `${prefix}cmp-${media.length}`, kind: kindOf(contentType, filename, url), url, proxyUrl, filename, contentType, size: m.size || 0, width: m.width, height: m.height, spoiler, source: "component" });
        };

        if (Array.isArray(node.items)) node.items.forEach((item: any) => pushMedia(item?.media, item?.spoiler));
        if (node.type === 13 && node.file) pushMedia(node.file, node.spoiler);
        if (node.type === 11 && node.media) pushMedia(node.media, node.spoiler);
        if (node.accessory) collectComponents([node.accessory], media, extraText, prefix, depth + 1);
        collectComponents(node.components, media, extraText, prefix, depth + 1);
    }
}

const SYSTEM_TEXT: Record<number, string> = {
    1: "Added someone to the group.",
    2: "Removed someone from the group.",
    3: "Started a call.",
    4: "Changed the channel name.",
    5: "Changed the channel icon.",
    6: "Pinned a message.",
    7: "Joined the server.",
    8: "Boosted the server.",
    18: "Started a thread.",
    46: "Poll results."
};

export function rawToLog(raw: RawMessage): LogMessage {
    const channelId = String(raw.channel_id);
    let channel: any = null;
    try { channel = ChannelStore.getChannel(channelId); } catch { }
    const guildId = raw.guild_id ? String(raw.guild_id) : (channel?.guild_id ? String(channel.guild_id) : null);
    let guild: any = null;
    try { guild = guildId ? GuildStore.getGuild(guildId) : null; } catch { }

    const a = raw.author ?? {};
    const authorId = a.id ? String(a.id) : null;
    const username = a.username || "unknown";
    const media: LogMedia[] = [];
    const extraText: string[] = [];

    collectAttachments(raw, media, "attachment", "");
    collectStickers(raw, media, extraText);
    const embeds = collectEmbeds(raw, media, "");
    collectComponents(raw.components, media, extraText, "");

    if (raw.poll?.question) {
        const question = raw.poll.question.text ?? "";
        const answers = (raw.poll.answers ?? []).map((ans: any) => `• ${ans?.poll_media?.text ?? ans?.pollMedia?.text ?? ""}`).join("\n");
        extraText.push(`Poll: ${question}${answers ? `\n${answers}` : ""}`);
    }

    let forwarded: LogMessage["forwarded"] = null;
    const snapshot = raw.message_snapshots?.[0]?.message;
    if (snapshot && (snapshot.content || snapshot.attachments?.length || snapshot.embeds?.length || snapshot.sticker_items?.length)) {
        collectAttachments(snapshot, media, "forward", "fwd-");
        collectStickers(snapshot, media, extraText);
        const fwdEmbeds = collectEmbeds(snapshot, media, "fwd-");
        collectComponents(snapshot.components, media, extraText, "fwd-");
        forwarded = { content: snapshot.content ?? "", embeds: fwdEmbeds };
    }

    if (!raw.content && !media.length && !embeds.length && !extraText.length && !forwarded && SYSTEM_TEXT[raw.type]) {
        extraText.push(SYSTEM_TEXT[raw.type]);
    }

    const mentionNames: Record<string, string> = {};
    for (const m of raw.mentions ?? []) {
        if (m?.id) mentionNames[String(m.id)] = m.global_name || m.globalName || m.username || "unknown-user";
    }

    let replyTo: LogMessage["replyTo"] = null;
    const ref = raw.referenced_message;
    if (ref && typeof ref === "object" && ref.author) {
        replyTo = {
            authorName: ref.author.global_name || ref.author.username || "Unknown",
            content: ref.content || (ref.attachments?.length ? "Attachment" : "")
        };
    }

    return {
        id: String(raw.id),
        channelId,
        guildId,
        guildName: guild?.name ?? null,
        guildIconUrl: guild ? guildIconUrl(guildId, guild.icon) : null,
        channelName: getChannelLabel(channelId),
        author: {
            id: authorId,
            name: a.global_name || a.globalName || username,
            username,
            avatarUrl: userAvatarUrl(authorId, a.avatar, a.discriminator),
            bot: !!a.bot
        },
        content: raw.content ?? "",
        timestamp: toIso(raw.timestamp) ?? new Date().toISOString(),
        editedTimestamp: toIso(raw.edited_timestamp),
        mentionEveryone: !!raw.mention_everyone,
        mentionIds: (raw.mentions ?? []).map((m: any) => String(typeof m === "string" ? m : m?.id ?? "")).filter(Boolean),
        mentionRoleIds: (raw.mention_roles ?? []).map(String),
        mentionNames,
        media,
        embeds,
        extraText,
        forwarded,
        replyTo
    };
}
