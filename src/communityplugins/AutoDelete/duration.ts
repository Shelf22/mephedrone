/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 KernelSpecter
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const UNIT_SECONDS = {
    w: 604800,
    d: 86400,
    h: 3600,
    m: 60,
    s: 1
} as const;

type Unit = keyof typeof UNIT_SECONDS;

/** Anything shorter than this is a foot-gun: the message would vanish before it renders. */
export const MIN_TTL = 3;
/** Discord's own bulk-delete horizon is 14 days, so there is no point tracking past it. */
export const MAX_TTL = 14 * UNIT_SECONDS.d;

const DURATION_RE = /(\d+(?:\.\d+)?)\s*(weeks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)/gi;

/**
 * Reads "45s", "10m", "1h 30m", "2 days" into seconds.
 * A bare number is read as seconds.
 * Returns null for anything it does not fully understand, rather than guessing.
 */
export function parseDuration(input: string): number | null {
    if (typeof input !== "string") return null;

    const text = input.trim();
    if (!text) return null;

    if (/^\d+(?:\.\d+)?$/.test(text)) {
        const bare = Math.round(Number(text));
        return bare > 0 ? bare : null;
    }

    let total = 0;
    let matched = false;

    for (const [, amount, unit] of text.matchAll(DURATION_RE)) {
        matched = true;
        total += Number(amount) * UNIT_SECONDS[unit[0].toLowerCase() as Unit];
    }

    if (!matched) return null;

    // Reject trailing junk ("5m potato") instead of silently accepting the 5m.
    const leftover = text.replace(DURATION_RE, " ").replace(/\band\b/gi, " ").replace(/[\s,+]/g, "");
    if (leftover) return null;

    const seconds = Math.round(total);
    return seconds > 0 ? seconds : null;
}

/** Seconds to "1h 30m". Keeps the two largest units, which is all anyone reads. */
export function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return "0s";

    let left = Math.round(seconds);
    const parts: string[] = [];

    for (const unit of ["w", "d", "h", "m", "s"] as const) {
        const size = UNIT_SECONDS[unit];
        const n = Math.floor(left / size);
        if (n > 0) {
            parts.push(`${n}${unit}`);
            left -= n * size;
        }
    }

    return parts.slice(0, 2).join(" ");
}

/** Milliseconds remaining to the label shown under a pending message. */
export function formatCountdown(ms: number): string {
    if (ms <= 0) return "now";

    const seconds = Math.ceil(ms / 1000);
    if (seconds < 60) return `${seconds}s`;

    return formatDuration(seconds);
}
