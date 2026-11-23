/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const HOST_REPLACEMENTS = new Map<string, string>([
    ["x.com", "fixupx.com"],
    ["www.x.com", "fixupx.com"],
    ["twitter.com", "fixupx.com"],
    ["www.twitter.com", "fixupx.com"],
    ["instagram.com", "eeinstagram.com"],
    ["www.instagram.com", "eeinstagram.com"],
    ["tiktok.com", "tnktok.com"],
    ["www.tiktok.com", "tnktok.com"],
    ["vm.tiktok.com", "tnktok.com"],
    ["vt.tiktok.com", "tnktok.com"],
    ["reddit.com", "rxddit.com"],
    ["www.reddit.com", "rxddit.com"],
    ["old.reddit.com", "rxddit.com"],
]);

export function rewriteSocialUrl(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;

    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        return null;
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    const replacement = HOST_REPLACEMENTS.get(url.hostname.toLowerCase());
    if (!replacement) return null;

    url.hostname = replacement;
    return url.toString();
}
