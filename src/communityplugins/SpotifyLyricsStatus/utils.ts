/**
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ilyau and contributors
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings } from "./settings";
import { LyricLine, Track } from "./types";

export const STATUS_LIMIT = 128;

const FEATURE_RE = /\s*[-([]\s*(feat\.?|ft\.?|featuring|with)\s+[^)\]]+[)\]]?/ig;
const VERSION_RE = /\s*\((?:official\s*)?(?:remaster(?:ed)?(?:\s+\d{4})?|sped up|slowed(?:\s+down)?|nightcore|radio edit|explicit|clean version)\)/ig;

type FontStyle = typeof settings.store.fontStyle;

export function cleanText(value: unknown) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function stripFeatureText(value: string) {
    return cleanText(value)
        .replace(FEATURE_RE, "")
        .replace(VERSION_RE, "")
        .replace(/\s+-\s+(remaster(?:ed)?(?:\s+\d{4})?)$/i, "")
        .trim();
}

export function firstArtist(value: string) {
    return cleanText(value).split(/\s*(?:,|&| x | feat\.?| ft\.?| featuring)\s*/i)[0] ?? "";
}

export function comparable(value: unknown) {
    return stripFeatureText(cleanText(value))
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, "")
        .replace(/\s+/g, " ")
        .trim();
}

export function trackKey(track: Pick<Track, "id" | "title" | "artist" | "durationMs">) {
    return [
        track.id,
        comparable(track.title),
        comparable(track.artist),
        Math.round((track.durationMs || 0) / 1000)
    ].join("|");
}

export function durationMs(value: unknown) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n < 10_000 ? Math.round(n * 1000) : Math.round(n);
}

export function parseTimestamp(raw: string) {
    const match = raw.trim().match(/^(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?$/);
    if (!match) return NaN;

    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    const fraction = match[3] ?? "0";
    const millis = fraction.length === 1
        ? Number(fraction) * 100
        : fraction.length === 2
            ? Number(fraction) * 10
            : Number(fraction.padEnd(3, "0").slice(0, 3));

    return minutes * 60_000 + seconds * 1000 + millis;
}

export function parseSyncedLyrics(raw: string): LyricLine[] {
    const lines: LyricLine[] = [];

    for (const row of String(raw || "").split(/\r?\n/)) {
        const stamps = [...row.matchAll(/\[(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)\]/g)];
        if (!stamps.length) continue;

        const text = cleanText(
            row
                .slice((stamps[stamps.length - 1].index ?? 0) + stamps[stamps.length - 1][0].length)
                .replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, " ")
        );

        if (!text || text === "♪" || /^[♪♫\-\.]+$/.test(text)) continue;

        for (const stamp of stamps) {
            const timeMs = parseTimestamp(stamp[1]);
            if (Number.isFinite(timeMs)) lines.push({ timeMs, text });
        }
    }

    lines.sort((a, b) => a.timeMs - b.timeMs);
    return dedupeLines(lines);
}

export function parsePlainLyrics(raw: string, durationMsValue: number): LyricLine[] {
    const rows = String(raw || "")
        .split(/\r?\n/)
        .map(cleanText)
        .filter(text => text && text !== "♪" && !/^(instrumental|\[instrumental\])$/i.test(text));

    if (!rows.length) return [];

    const usable = Math.max(30_000, durationMsValue || rows.length * 3500);
    const intro = Math.min(12_000, Math.max(4000, Math.round(usable * 0.04)));
    const step = Math.max(1800, Math.round((usable - intro) / rows.length));

    return rows.map((text, index) => ({
        timeMs: intro + index * step,
        text
    }));
}

function dedupeLines(lines: LyricLine[]) {
    const out: LyricLine[] = [];
    for (const line of lines) {
        const prev = out[out.length - 1];
        if (prev && prev.timeMs === line.timeMs && prev.text === line.text) continue;
        out.push(line);
    }
    return out;
}

export function currentLine(lines: LyricLine[], progressMs: number, gapThresholdMs: number): LyricLine | undefined {
    if (!lines.length || progressMs < lines[0].timeMs) return undefined;

    let low = 0;
    let high = lines.length - 1;
    let index = -1;

    while (low <= high) {
        const mid = (low + high) >> 1;
        if (lines[mid].timeMs <= progressMs) {
            index = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    if (index < 0) return undefined;

    const line = lines[index];
    const next = lines[index + 1];
    if (next && next.timeMs - line.timeMs >= gapThresholdMs) {
        const holdMs = Math.min(next.timeMs - line.timeMs - 200, Math.max(2400, [...line.text].length * 80));
        if (progressMs >= line.timeMs + holdMs) return undefined;
    }

    return line;
}

function mapLetters(text: string, mapper: (code: number, ch: string) => string) {
    return [...text].map(ch => mapper(ch.codePointAt(0)!, ch)).join("");
}

function mathMap(code: number, upperStart: number, lowerStart: number, digitStart?: number) {
    if (code >= 65 && code <= 90) return String.fromCodePoint(upperStart + (code - 65));
    if (code >= 97 && code <= 122) return String.fromCodePoint(lowerStart + (code - 97));
    if (digitStart != null && code >= 48 && code <= 57) return String.fromCodePoint(digitStart + (code - 48));
    return String.fromCodePoint(code);
}

export function stylize(text: string, style: FontStyle) {
    switch (style) {
        case "uppercase":
            return text.toUpperCase();
        case "lowercase":
            return text.toLowerCase();
        case "title":
            return text.replace(/\S+/g, word => word[0].toUpperCase() + word.slice(1).toLowerCase());
        case "wide":
            return [...text].join(" ").replace(/ +/g, " ");
        case "fullwidth":
            return mapLetters(text, (code, ch) => {
                if (code === 32) return "\u3000";
                if (code >= 33 && code <= 126) return String.fromCodePoint(0xFF01 + (code - 33));
                return ch;
            });
        case "bold":
            return mapLetters(text, (code, ch) => mathMap(code, 0x1D400, 0x1D41A, 0x1D7CE) || ch);
        case "italic":
            return mapLetters(text, (code, ch) => {
                if (code === 104) return "\u210E";
                return mathMap(code, 0x1D434, 0x1D44E) || ch;
            });
        case "smallCaps":
            return mapLetters(text.toLowerCase(), (code, ch) => {
                const map: Record<number, string> = {
                    97: "ᴀ", 98: "ʙ", 99: "ᴄ", 100: "ᴅ", 101: "ᴇ", 102: "ꜰ", 103: "ɢ",
                    104: "ʜ", 105: "ɪ", 106: "ᴊ", 107: "ᴋ", 108: "ʟ", 109: "ᴍ", 110: "ɴ",
                    111: "ᴏ", 112: "ᴘ", 113: "ǫ", 114: "ʀ", 115: "ꜱ", 116: "ᴛ", 117: "ᴜ",
                    118: "ᴠ", 119: "ᴡ", 120: "x", 121: "ʏ", 122: "ᴢ"
                };
                return map[code] ?? ch;
            });
        default:
            return text;
    }
}

export function utf16Length(value: string) {
    return value.length;
}

export function truncateStatus(value: string, limit = STATUS_LIMIT) {
    if (utf16Length(value) <= limit) return value;

    const chars = [...value];
    let out = "";
    for (const ch of chars) {
        if (utf16Length(out + ch) > limit - 1) break;
        out += ch;
    }
    return `${out}…`;
}

export function formatStatus(text: string, applyFont = true) {
    const prefix = cleanText(settings.store.prefix);
    const body = applyFont ? stylize(cleanText(text), settings.store.fontStyle) : cleanText(text);
    const joined = prefix ? `${prefix} ${body}` : body;
    return truncateStatus(joined, Math.max(8, Number(settings.store.maxStatusLength) || STATUS_LIMIT));
}

export function lyricPage(line: LyricLine, nextTimeMs: number | undefined, progressMs: number, offsetMs: number) {
    const maxLength = Math.max(8, Math.min(STATUS_LIMIT, Number(settings.store.maxStatusLength) || STATUS_LIMIT));
    const prefixLen = cleanText(settings.store.prefix) ? cleanText(settings.store.prefix).length + 1 : 0;
    const budget = Math.max(8, maxLength - prefixLen);
    const styled = stylize(line.text, settings.store.fontStyle);

    if (utf16Length(styled) <= budget) return formatStatus(line.text);

    const words = line.text.split(" ").filter(Boolean);
    const chunks: string[] = [];
    let current = "";

    for (const word of words) {
        const styledWord = stylize(word, settings.store.fontStyle);
        const candidate = current ? `${current} ${word}` : word;
        const styledCandidate = stylize(candidate, settings.store.fontStyle);
        if (utf16Length(styledCandidate) <= budget) {
            current = candidate;
            continue;
        }
        if (current) chunks.push(current);
        if (utf16Length(styledWord) <= budget) {
            current = word;
            continue;
        }

        const letters = [...word];
        let piece = "";
        for (const letter of letters) {
            const next = piece + letter;
            if (utf16Length(stylize(next, settings.store.fontStyle)) <= budget) piece = next;
            else {
                if (piece) chunks.push(piece);
                piece = letter;
            }
        }
        current = piece;
    }
    if (current) chunks.push(current);
    if (chunks.length <= 1) return formatStatus(chunks[0] || line.text);

    const duration = Math.max(chunks.length * 1400, (nextTimeMs ?? line.timeMs + chunks.length * 2000) - line.timeMs);
    const elapsed = Math.max(0, progressMs - line.timeMs - offsetMs);
    const index = Math.min(chunks.length - 1, Math.floor(elapsed / (duration / chunks.length)));
    return formatStatus(chunks[index]);
}

export function sleep(ms: number) {
    return new Promise<void>(resolve => window.setTimeout(resolve, Math.max(0, ms)));
}

export function scoreMatch(result: { title?: string; artist?: string; album?: string; duration?: number; }, track: Track) {
    let score = 0;
    const title = comparable(track.title);
    const artist = comparable(firstArtist(track.artist));
    const album = comparable(track.album);
    const resultTitle = comparable(result.title);
    const resultArtist = comparable(result.artist);
    const resultAlbum = comparable(result.album);

    if (resultTitle === title) score += 8;
    else if (resultTitle.includes(title) || title.includes(resultTitle)) score += 4;

    if (artist && resultArtist.includes(artist)) score += 4;
    if (album && resultAlbum === album) score += 2;

    if (track.durationMs && result.duration) {
        const diff = Math.abs(result.duration - Math.round(track.durationMs / 1000));
        if (diff <= 2) score += 5;
        else if (diff <= 8) score += 2;
        else if (diff > 20) score -= 3;
    }

    return score;
}
