/**
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ilyau and contributors
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface Track {
    id: string;
    title: string;
    artist: string;
    album: string;
    albumImage: string;
    durationMs: number;
    progressMs: number;
    isPlaying: boolean;
    isPodcast: boolean;
}

export interface LyricLine {
    timeMs: number;
    text: string;
}

export interface LyricsResult {
    lines: LyricLine[];
    source: "lrclib" | "deezer" | "netease" | "plain";
    synced: boolean;
}

export interface CustomStatusValue {
    text?: string;
    emojiId?: string;
    emojiName?: string;
    expiresAtMs?: string;
    createdAtMs?: string;
}

export interface NativeFetchRequest {
    url: string;
    method?: "GET" | "POST";
    body?: string;
    headers?: Record<string, string>;
}

export interface NativeFetchResponse {
    status: number;
    data: unknown;
}

export interface WindowsSpotifyState {
    processRunning?: boolean;
    track?: {
        title?: string;
        artist?: string;
        album?: string;
        status?: string;
        positionMs?: number;
        durationMs?: number;
    } | null;
}
