/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const YOUTUBE_HOSTS = new Set([
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
]);

export function isSupportedYouTubeUrl(input: string): boolean {
    try {
        const url = new URL(input.trim());
        return (url.protocol === "https:" || url.protocol === "http:")
            && YOUTUBE_HOSTS.has(url.hostname.toLowerCase());
    } catch {
        return false;
    }
}

export function buildRelayEndpoint(baseUrl: string): string {
    const url = new URL(baseUrl.trim());
    const hostname = url.hostname.toLowerCase();

    if (url.protocol !== "http:") {
        throw new Error("The local relay must use HTTP.");
    }

    if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "[::1]") {
        throw new Error("The relay URL must point to localhost.");
    }

    url.pathname = "/download";
    url.search = "";
    url.hash = "";
    return url.toString();
}

export function safeDownloadName(value: string | null): string {
    const fallback = "youtube-video.mp4";
    if (!value) return fallback;

    const safe = value
        .replace(/[^A-Za-z0-9._ -]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);

    if (!safe) return fallback;
    return safe.toLowerCase().endsWith(".mp4") ? safe : `${safe}.mp4`;
}
