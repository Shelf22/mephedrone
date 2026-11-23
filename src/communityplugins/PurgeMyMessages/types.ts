/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Gaiiiaaa
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface PurgeOptions {
    channelId: string;
    guildId?: string;
    authorId: string;
    delayMs: number;
    jitterMs: number;
    limit: number; // 0 = no limit (delete all found)
    filterText?: string;
    mode: "search" | "history";
}

export interface DeletedMessagePreview {
    id: string;
    content: string;
    timestamp: string;
}

export interface PurgeStats {
    totalFound: number;
    deletedCount: number;
    failedCount: number;
    /**
     * Vrai uniquement en mode recherche : Discord renvoie `total_results`, donc
     * `totalFound` est une vraie cible et le pourcentage a un sens. En mode
     * historique on découvre les messages au fil de l'eau — pas de pourcentage.
     */
    isTotalKnown: boolean;
    isSearching: boolean;
    isDeleting: boolean;
    isPaused: boolean;
    isStopped: boolean;
    isDone: boolean;
    statusText: string;
    lastDeletedMessage?: DeletedMessagePreview;
    rateLimitWaitSeconds?: number;
}

export interface DiscordSearchAuthor {
    id: string;
    username: string;
    discriminator?: string;
    avatar?: string;
}

export interface DiscordMessage {
    id: string;
    /** Peut différer du salon ciblé : la recherche remonte aussi les fils du salon. */
    channel_id: string;
    content: string;
    timestamp: string;
    hit?: boolean;
    author?: DiscordSearchAuthor;
    attachments?: unknown[];
}

export interface DiscordSearchResponse {
    total_results: number;
    messages: DiscordMessage[][];
}
