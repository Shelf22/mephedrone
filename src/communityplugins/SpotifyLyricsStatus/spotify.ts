/**
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ilyau and contributors
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { SpotifyStore as ControlsStore } from "@plugins/spotifyControls/SpotifyStore";
import { Logger } from "@utils/Logger";
import { PluginNative } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { PresenceStore, UserStore } from "@webpack/common";

import { settings } from "./settings";
import { Track, WindowsSpotifyState } from "./types";
import { cleanText, durationMs, firstArtist } from "./utils";

const logger = new Logger("SpotifyLyricsStatus");
const Native = VencordNative.pluginHelpers.SpotifyLyricsStatus as PluginNative<typeof import("./native")> | undefined;
const DiscordSpotifyStore = findStoreLazy("SpotifyStore");

interface PlayerEvent {
    track?: {
        id?: string | null;
        name?: string;
        duration?: number;
        duration_ms?: number;
        type?: string;
        album?: { name?: string; image?: { url?: string; }; images?: Array<{ url?: string; }>; };
        artists?: Array<{ name?: string; }>;
        show?: { name?: string; publisher?: string; images?: Array<{ url?: string; }>; };
        images?: Array<{ url?: string; }>;
        publisher?: string;
    } | null;
    isPlaying?: boolean;
    position?: number;
}

let lastEvent: PlayerEvent | undefined;
let lastEventAt = 0;
let windowsTrack: Track | undefined;
let windowsTrackAt = 0;
let windowsProcessRunning = false;
let windowsSeenAt = 0;
let windowsPollAt = 0;
let windowsPollInFlight = false;

function debug(message: string) {
    if (settings.store.debugLog) logger.info(message);
}

function albumImage(track: NonNullable<PlayerEvent["track"]>) {
    return cleanText(
        track.album?.image?.url
        || track.album?.images?.[0]?.url
        || track.images?.[0]?.url
        || track.show?.images?.[0]?.url
    );
}

export function rememberPlayerEvent(event: PlayerEvent) {
    if (!event?.track?.name) {
        lastEvent = undefined;
        lastEventAt = Date.now();
        return;
    }

    lastEvent = event;
    lastEventAt = Date.now();
}

function fromPlayerEvent(event: PlayerEvent, receivedAt: number): Track | undefined {
    const raw = event.track;
    if (!raw?.name) return undefined;

    const artists = raw.artists?.map(artist => artist.name).filter(Boolean).join(", ")
        || raw.show?.publisher
        || raw.publisher
        || "";
    const isPodcast = raw.type === "episode" || Boolean(raw.show);
    const duration = durationMs(raw.duration_ms ?? raw.duration);
    const position = Number(event.position) || 0;
    const isPlaying = Boolean(event.isPlaying);
    const progressMs = isPlaying ? position + Math.max(0, Date.now() - receivedAt) : position;

    return {
        id: cleanText(raw.id) || `${raw.name}|${artists}|${duration}`,
        title: cleanText(raw.name),
        artist: cleanText(artists) || (isPodcast ? "Podcast" : "Unknown artist"),
        album: cleanText(raw.album?.name || raw.show?.name),
        albumImage: albumImage(raw),
        durationMs: duration,
        progressMs: Math.max(0, duration ? Math.min(progressMs, duration) : progressMs),
        isPlaying,
        isPodcast
    };
}

function fromControlsStore(): Track | undefined {
    try {
        const track = ControlsStore.track;
        if (!track?.name) return undefined;

        return {
            id: track.id || `${track.name}|${track.artists?.map(a => a.name).join(", ")}`,
            title: cleanText(track.name),
            artist: cleanText(track.artists?.map(a => a.name).filter(Boolean).join(", ")) || "Unknown artist",
            album: cleanText(track.album?.name),
            albumImage: cleanText(track.album?.image?.url),
            durationMs: durationMs(track.duration),
            progressMs: Math.max(0, ControlsStore.position || 0),
            isPlaying: Boolean(ControlsStore.isPlaying),
            isPodcast: false
        };
    } catch {
        return undefined;
    }
}

function fromDiscordStore(): Track | undefined {
    try {
        const store = DiscordSpotifyStore as {
            getTrack?: () => { id?: string; name?: string; duration?: number; album?: { name?: string; image?: { url?: string; } | null; }; artists?: Array<{ name?: string; }>; } | null;
            getActivity?: () => { details?: string; state?: string; timestamps?: { start?: number; end?: number; }; assets?: { large_image?: string; large_text?: string; }; } | null;
        };

        const track = store.getTrack?.();
        const activity = store.getActivity?.();
        if (track?.name) {
            const duration = durationMs(track.duration);
            const start = activity?.timestamps?.start;
            const progress = start ? Date.now() - start : 0;
            return {
                id: cleanText(track.id) || track.name,
                title: cleanText(track.name),
                artist: cleanText(track.artists?.map(a => a.name).filter(Boolean).join(", ")) || "Unknown artist",
                album: cleanText(track.album?.name || activity?.assets?.large_text),
                albumImage: cleanText(track.album?.image?.url),
                durationMs: duration,
                progressMs: Math.max(0, duration ? Math.min(progress, duration) : progress),
                isPlaying: Boolean(activity?.timestamps?.end && Date.now() < activity.timestamps.end),
                isPodcast: false
            };
        }

        if (activity?.details) {
            const start = activity.timestamps?.start ?? Date.now();
            const end = activity.timestamps?.end;
            const duration = end && end > start ? end - start : 0;
            return {
                id: `${activity.details}|${activity.state}|${duration}`,
                title: cleanText(activity.details),
                artist: cleanText(activity.state) || "Unknown artist",
                album: cleanText(activity.assets?.large_text),
                albumImage: "",
                durationMs: duration,
                progressMs: Math.max(0, duration ? Math.min(Date.now() - start, duration) : Date.now() - start),
                isPlaying: Boolean(end && Date.now() < end),
                isPodcast: false
            };
        }
    } catch {
        return undefined;
    }

    return undefined;
}

function fromPresence(): Track | undefined {
    try {
        const userId = UserStore.getCurrentUser()?.id;
        if (!userId) return undefined;

        const activity = PresenceStore.getActivities(userId)?.find(item => item.name === "Spotify" || item.sync_id);
        if (!activity?.details) return undefined;

        const start = activity.timestamps?.start ?? Date.now();
        const end = activity.timestamps?.end;
        const duration = end && end > start ? end - start : 0;

        return {
            id: cleanText(activity.sync_id) || `${activity.details}|${activity.state}`,
            title: cleanText(activity.details),
            artist: cleanText(activity.state) || "Unknown artist",
            album: cleanText(activity.assets?.large_text),
            albumImage: "",
            durationMs: duration,
            progressMs: Math.max(0, duration ? Math.min(Date.now() - start, duration) : Date.now() - start),
            isPlaying: Boolean(end && Date.now() < end),
            isPodcast: false
        };
    } catch {
        return undefined;
    }
}

function fromWindows(state: WindowsSpotifyState): Track | undefined {
    const raw = state.track;
    if (!raw?.title) return undefined;

    const duration = durationMs(raw.durationMs);
    const position = Number(raw.positionMs) || 0;
    const isPlaying = cleanText(raw.status).toLowerCase() === "playing";

    return {
        id: `${raw.title}|${raw.artist}|${duration}`,
        title: cleanText(raw.title),
        artist: cleanText(raw.artist) || "Unknown artist",
        album: cleanText(raw.album),
        albumImage: "",
        durationMs: duration,
        progressMs: Math.max(0, duration ? Math.min(position, duration) : position),
        isPlaying,
        isPodcast: false
    };
}

export function songFallback(track: Track) {
    const artist = firstArtist(track.artist);
    return artist ? `${track.title} - ${artist}` : track.title;
}

export async function pollWindowsSpotify(force = false) {
    if (!Native?.getWindowsSpotifyState) return;
    if (windowsPollInFlight) return;
    if (!force && Date.now() - windowsPollAt < 2000) return;

    windowsPollInFlight = true;
    windowsPollAt = Date.now();

    try {
        const state = await Native.getWindowsSpotifyState();
        windowsProcessRunning = Boolean(state.processRunning);
        if (windowsProcessRunning) windowsSeenAt = Date.now();

        const track = fromWindows(state);
        if (track) {
            windowsTrack = track;
            windowsTrackAt = Date.now();
            debug(`windows spotify ${track.isPlaying ? "playing" : "paused"} "${track.title}"`);
        }
    } catch (error) {
        debug(`windows spotify poll failed ${String(error)}`);
    } finally {
        windowsPollInFlight = false;
    }
}

export function windowsSpotifyActive() {
    return windowsProcessRunning || Date.now() - windowsSeenAt < 8000;
}

export function getCurrentTrack(): Track | undefined {
    if (lastEvent?.track && Date.now() - lastEventAt < 15_000) {
        const track = fromPlayerEvent(lastEvent, lastEventAt);
        if (track) return track;
    }

    const controls = fromControlsStore();
    if (controls?.title) return controls;

    const discord = fromDiscordStore();
    if (discord?.title) return discord;

    const presence = fromPresence();
    if (presence?.title) return presence;

    if (windowsTrack && Date.now() - windowsTrackAt < 8000) {
        const track = { ...windowsTrack };
        if (track.isPlaying) track.progressMs += Date.now() - windowsTrackAt;
        return track;
    }

    return undefined;
}
