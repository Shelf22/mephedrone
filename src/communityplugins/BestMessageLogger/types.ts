/*
 * BestMessageLogger, a Vencord plugin by Kh8da
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type Tab = "deleted" | "edited" | "ghostPings";
export type Scope = "all" | "servers" | "dms";

/** A message in Discord's API shape (snake_case), safe to JSON encode. */
export type RawMessage = Record<string, any> & {
    id: string;
    channel_id: string;
    content: string;
    author: Record<string, any>;
};

export type MediaKind = "image" | "video" | "audio" | "file";

export interface LogMedia {
    /** Stable key inside the message, used for the offline copy. */
    key: string;
    kind: MediaKind;
    url: string;
    proxyUrl: string;
    filename: string;
    contentType: string;
    size: number;
    width?: number;
    height?: number;
    spoiler?: boolean;
    /** true for gifv style videos that should loop without controls */
    gifv?: boolean;
    source: "attachment" | "embed" | "sticker" | "component" | "forward";
    /** true once a copy is stored on this computer */
    saved?: boolean;
}

export interface LogEmbed {
    color: string | null;
    title: string;
    url: string;
    description: string;
    authorName: string;
    authorIcon: string;
    providerName: string;
    footerText: string;
    fields: Array<{ name: string; value: string; inline: boolean; }>;
    thumbnail: string;
    image: string;
}

export interface LogAuthor {
    id: string | null;
    name: string;
    username: string;
    avatarUrl: string;
    bot: boolean;
}

export interface LogMessage {
    id: string;
    channelId: string;
    guildId: string | null;
    /** names captured when the message was logged, used when the server or channel is gone */
    guildName: string | null;
    guildIconUrl: string | null;
    channelName: string | null;
    author: LogAuthor;
    content: string;
    timestamp: string;
    editedTimestamp: string | null;
    mentionEveryone: boolean;
    mentionIds: string[];
    mentionRoleIds: string[];
    /** user id to display name, captured from the message */
    mentionNames: Record<string, string>;
    media: LogMedia[];
    embeds: LogEmbed[];
    /** text of components v2, polls and similar parts that have no normal content */
    extraText: string[];
    forwarded: { content: string; embeds: LogEmbed[]; } | null;
    replyTo: { authorName: string; content: string; } | null;
}

export interface DeleteEntry {
    tab: "deleted";
    key: string;
    deletedAt: string;
    kind: "delete" | "bulk-delete";
    message: LogMessage;
    /** the original message, used to put it back into chat */
    raw: RawMessage;
    rawFromApi: boolean;
    /** true after "Clear Message History" in chat; the entry stays in the log menu only */
    hiddenInChat?: boolean;
}

export interface EditEntry {
    tab: "edited";
    key: string;
    editedAt: string;
    messageId: string;
    channelId: string;
    before: LogMessage;
    after: LogMessage;
}

export interface GhostPingEntry {
    tab: "ghostPings";
    key: string;
    detectedAt: string;
    reason: "deleted" | "edited";
    message: LogMessage;
}

export type LogEntry = DeleteEntry | EditEntry | GhostPingEntry;
