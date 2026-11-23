/**
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ilyau and contributors
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { PluginNative } from "@utils/types";

import { settings } from "./settings";
import { LyricsResult, NativeFetchRequest, NativeFetchResponse, Track } from "./types";
import { comparable, firstArtist, parsePlainLyrics, parseSyncedLyrics, scoreMatch, stripFeatureText, trackKey } from "./utils";

const logger = new Logger("SpotifyLyricsStatus");
const Native = VencordNative.pluginHelpers.SpotifyLyricsStatus as PluginNative<typeof import("./native")> | undefined;

const cache = new Map<string, LyricsResult | null>();
const inflight = new Map<string, Promise<LyricsResult | null>>();

let abortId = 0;
let deezerToken = "";
let deezerTokenAt = 0;

interface LrcLibHit {
    trackName?: string;
    artistName?: string;
    albumName?: string;
    duration?: number;
    plainLyrics?: string | null;
    syncedLyrics?: string | null;
    synced_lyrics?: string | null;
}

interface DeezerSearchHit {
    id?: number;
    title?: string;
    duration?: number;
    artist?: { name?: string; };
    album?: { title?: string; };
}

interface DeezerLyrics {
    LYRICS_SYNC_JSON?: Array<{ milliseconds?: string | number; line?: string; lrc_timestamp?: string; }>;
    LYRICS_TEXT?: string;
}

interface NetEaseSearch {
    result?: { songs?: Array<{ id?: number; name?: string; duration?: number; artists?: Array<{ name?: string; }>; album?: { name?: string; }; }>; };
}

interface NetEaseLyric {
    lrc?: { lyric?: string; };
}

function debug(message: string) {
    if (settings.store.debugLog) logger.info(message);
}

async function request(spec: NativeFetchRequest): Promise<NativeFetchResponse> {
    if (Native?.fetchJson) return Native.fetchJson(spec);

    const response = await fetch(spec.url, {
        method: spec.method ?? "GET",
        headers: {
            Accept: "application/json",
            ...spec.headers
        },
        body: spec.method === "POST" ? spec.body ?? "{}" : undefined
    });

    if (response.status === 404) return { status: 404, data: null };

    const text = await response.text();
    return {
        status: response.status,
        data: text ? JSON.parse(text) : null
    };
}

function queriesFor(track: Track) {
    const title = stripFeatureText(track.title);
    const artist = firstArtist(track.artist);
    return [
        `${track.title} ${track.artist}`,
        `${title} ${artist}`,
        `${title} ${track.artist}`,
        `${track.title} ${artist}`
    ].filter((query, index, all) => query.trim() && all.indexOf(query) === index);
}

async function lrclibExact(track: Track): Promise<LrcLibHit | null> {
    const params = new URLSearchParams({
        track_name: track.title,
        artist_name: firstArtist(track.artist) || track.artist
    });
    if (track.album) params.set("album_name", track.album);
    if (track.durationMs) params.set("duration", String(Math.round(track.durationMs / 1000)));

    const response = await request({ url: `https://lrclib.net/api/get?${params}` });
    if (response.status === 404 || !response.data) return null;
    if (response.status < 200 || response.status >= 300) throw new Error(`LRCLIB ${response.status}`);
    return response.data as LrcLibHit;
}

async function lrclibSearch(track: Track): Promise<LrcLibHit | null> {
    for (const query of queriesFor(track)) {
        const response = await request({ url: `https://lrclib.net/api/search?${new URLSearchParams({ q: query })}` });
        if (response.status < 200 || response.status >= 300 || !Array.isArray(response.data)) continue;

        const match = (response.data as LrcLibHit[])
            .filter(hit => hit.syncedLyrics || hit.synced_lyrics || (settings.store.usePlainLyricsFallback && hit.plainLyrics))
            .sort((a, b) => scoreMatch({
                title: b.trackName,
                artist: b.artistName,
                album: b.albumName,
                duration: b.duration
            }, track) - scoreMatch({
                title: a.trackName,
                artist: a.artistName,
                album: a.albumName,
                duration: a.duration
            }, track))[0];

        if (match) return match;
    }

    return null;
}

function fromLrclib(hit: LrcLibHit | null, track: Track): LyricsResult | null {
    if (!hit) return null;

    const synced = parseSyncedLyrics(hit.syncedLyrics || hit.synced_lyrics || "");
    if (synced.length) return { lines: synced, source: "lrclib", synced: true };

    if (settings.store.usePlainLyricsFallback && hit.plainLyrics) {
        const lines = parsePlainLyrics(hit.plainLyrics, track.durationMs);
        if (lines.length) return { lines, source: "plain", synced: false };
    }

    return null;
}

async function deezerApiToken() {
    if (deezerToken && Date.now() - deezerTokenAt < 25 * 60_000) return deezerToken;

    const response = await request({
        url: "https://www.deezer.com/ajax/gw-light.php?method=deezer.getUserData&input=3&api_version=1.0&api_token=",
        method: "POST",
        body: "{}",
        headers: { "Content-Type": "text/plain;charset=UTF-8" }
    });

    const token = (response.data as { results?: { checkForm?: string; }; } | null)?.results?.checkForm;
    if (!token) throw new Error("Deezer session token missing");

    deezerToken = token;
    deezerTokenAt = Date.now();
    return token;
}

async function fromDeezer(track: Track): Promise<LyricsResult | null> {
    const search = await request({
        url: `https://api.deezer.com/search?${new URLSearchParams({ q: `${stripFeatureText(track.title)} ${firstArtist(track.artist)}`, limit: "8" })}`
    });
    const hits = (search.data as { data?: DeezerSearchHit[]; } | null)?.data;
    if (!Array.isArray(hits) || !hits.length) return null;

    const match = hits
        .filter(hit => hit.id && hit.title)
        .sort((a, b) => scoreMatch({
            title: b.title,
            artist: b.artist?.name,
            album: b.album?.title,
            duration: b.duration
        }, track) - scoreMatch({
            title: a.title,
            artist: a.artist?.name,
            album: a.album?.title,
            duration: a.duration
        }, track))[0];

    if (!match?.id || scoreMatch({
        title: match.title,
        artist: match.artist?.name,
        album: match.album?.title,
        duration: match.duration
    }, track) < 6) return null;

    const token = await deezerApiToken();
    const lyrics = await request({
        url: `https://www.deezer.com/ajax/gw-light.php?method=song.getLyrics&input=3&api_version=1.0&api_token=${encodeURIComponent(token)}`,
        method: "POST",
        body: JSON.stringify({ sng_id: match.id }),
        headers: { "Content-Type": "text/plain;charset=UTF-8" }
    });

    const body = (lyrics.data as { results?: DeezerLyrics; error?: unknown; } | null)?.results;
    const synced = (body?.LYRICS_SYNC_JSON ?? [])
        .map(row => ({
            timeMs: Number(row.milliseconds),
            text: String(row.line || "").trim()
        }))
        .filter(row => Number.isFinite(row.timeMs) && row.text && row.text !== "♪");

    if (synced.length) return { lines: synced, source: "deezer", synced: true };

    if (settings.store.usePlainLyricsFallback && body?.LYRICS_TEXT) {
        const lines = parsePlainLyrics(body.LYRICS_TEXT, track.durationMs);
        if (lines.length) return { lines, source: "plain", synced: false };
    }

    return null;
}

async function fromNetEase(track: Track): Promise<LyricsResult | null> {
    const search = await request({
        url: `https://music.163.com/api/search/get/web?${new URLSearchParams({
            s: `${stripFeatureText(track.title)} ${firstArtist(track.artist)}`,
            type: "1",
            offset: "0",
            limit: "5"
        })}`
    });

    const songs = (search.data as NetEaseSearch | null)?.result?.songs ?? [];
    const match = songs.sort((a, b) => scoreMatch({
        title: b.name,
        artist: b.artists?.map(artist => artist.name).join(", "),
        album: b.album?.name,
        duration: b.duration ? Math.round(b.duration / 1000) : undefined
    }, track) - scoreMatch({
        title: a.name,
        artist: a.artists?.map(artist => artist.name).join(", "),
        album: a.album?.name,
        duration: a.duration ? Math.round(a.duration / 1000) : undefined
    }, track))[0];

    if (!match?.id) return null;
    if (comparable(match.name) !== comparable(track.title) && !comparable(match.name).includes(comparable(stripFeatureText(track.title)))) {
        const score = scoreMatch({
            title: match.name,
            artist: match.artists?.map(artist => artist.name).join(", "),
            album: match.album?.name,
            duration: match.duration ? Math.round(match.duration / 1000) : undefined
        }, track);
        if (score < 8) return null;
    }

    const lyric = await request({
        url: `https://music.163.com/api/song/lyric?id=${match.id}&lv=1&kv=1&tv=-1`
    });
    const lrc = (lyric.data as NetEaseLyric | null)?.lrc?.lyric;
    const synced = parseSyncedLyrics(lrc || "");
    if (synced.length) return { lines: synced, source: "netease", synced: true };

    if (settings.store.usePlainLyricsFallback && lrc) {
        const lines = parsePlainLyrics(lrc.replace(/\[\d.+$/gm, ""), track.durationMs);
        if (lines.length) return { lines, source: "plain", synced: false };
    }

    return null;
}

function providerOrder(): Array<(track: Track) => Promise<LyricsResult | null>> {
    const lrclib = async (track: Track) => fromLrclib(await lrclibExact(track) ?? await lrclibSearch(track), track);
    switch (settings.store.lyricsProvider) {
        case "lrclib":
            return [lrclib];
        case "deezer":
            return [fromDeezer, lrclib];
        case "netease":
            return [fromNetEase, lrclib];
        default:
            return [lrclib, fromDeezer, fromNetEase];
    }
}

async function lookup(track: Track): Promise<LyricsResult | null> {
    for (const provider of providerOrder()) {
        try {
            const result = await provider(track);
            if (result?.lines.length) {
                debug(`lyrics from ${result.source} (${result.lines.length} lines) for "${track.title}"`);
                return result;
            }
        } catch (error) {
            debug(`lyrics provider failed ${String(error)}`);
        }
    }

    debug(`no lyrics for "${track.title}"`);
    return null;
}

export function cachedLyrics(track: Track) {
    return cache.get(trackKey(track));
}

export function clearLyricsCache() {
    cache.clear();
    inflight.clear();
    abortId++;
}

export function loadLyrics(track: Track) {
    if (track.isPodcast) return Promise.resolve(null);

    const key = trackKey(track);
    if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null);
    if (inflight.has(key)) return inflight.get(key)!;

    const generation = abortId;
    const pending = lookup(track).then(result => {
        if (generation !== abortId) return result;
        cache.set(key, result);
        if (cache.size > 80) {
            const first = cache.keys().next().value;
            if (first) cache.delete(first);
        }
        return result;
    }).finally(() => {
        inflight.delete(key);
    });

    inflight.set(key, pending);
    return pending;
}
