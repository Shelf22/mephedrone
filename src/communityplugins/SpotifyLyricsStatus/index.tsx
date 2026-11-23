/**
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ilyau and contributors
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Paragraph } from "@components/Paragraph";
import { Logger } from "@utils/Logger";
import { Margins } from "@utils/margins";
import definePlugin from "@utils/types";
import { Forms } from "@webpack/common";

import { cachedLyrics, loadLyrics } from "./lyrics";
import { clearRpc, onRpcAsset, updateRpc } from "./rpc";
import { settings } from "./settings";
import { getCurrentTrack, pollWindowsSpotify, rememberPlayerEvent, songFallback, windowsSpotifyActive } from "./spotify";
import {
    captureOriginalStatus,
    forgetOriginalStatus,
    hasCapturedOriginal,
    lastDisplayedStatus,
    resetStatusRuntime,
    restoreStatus,
    setStatusText,
    shutdownStatus
} from "./status";
import { LyricLine, Track } from "./types";
import { currentLine, formatStatus, lyricPage, trackKey } from "./utils";

const logger = new Logger("SpotifyLyricsStatus");

let timer: ReturnType<typeof setInterval> | undefined;
let lastKey = "";
let loadingKey = "";
let lines: LyricLine[] = [];
let lastPlaying: boolean | undefined;

function debug(message: string) {
    if (settings.store.debugLog) logger.info(message);
}

function waitingDots() {
    return ".".repeat((Math.floor(Date.now() / 700) % 3) + 1);
}

function offsetMs() {
    const value = Number(settings.store.lyricOffsetMs);
    return Number.isFinite(value) ? value : 650;
}

function gapMs() {
    const value = Number(settings.store.gapThresholdMs);
    return Number.isFinite(value) && value > 0 ? value : 4000;
}

function applySongStatus(track: Track, paused = false) {
    const text = paused
        ? `${settings.store.pausedPrefix}${track.title}`
        : songFallback(track);
    setStatusText(formatStatus(text, false), paused);
}

function applyNoLyrics(track: Track) {
    switch (settings.store.noLyricsBehavior) {
        case "message":
            setStatusText(formatStatus(settings.store.noLyricsText, false));
            return;
        case "dots":
            setStatusText(waitingDots());
            return;
        case "keep":
            return;
        default:
            applySongStatus(track);
    }
}

function prepareTrack(track: Track) {
    const key = trackKey(track);
    if (key === lastKey) return;

    lastKey = key;
    loadingKey = key;
    lines = [];
    debug(`track "${track.title}" — ${track.artist}`);

    if (track.isPodcast) {
        loadingKey = "";
        return;
    }

    void loadLyrics(track).then(result => {
        if (trackKey(getCurrentTrack() ?? track) !== key) return;
        lines = result?.lines ?? [];
        loadingKey = "";
        tick();
    }).catch(error => {
        logger.warn("Lyric lookup failed", error);
        if (lastKey === key) {
            lines = [];
            loadingKey = "";
            tick();
        }
    });
}

function tick() {
    void pollWindowsSpotify();

    if (!hasCapturedOriginal()) {
        void captureOriginalStatus();
        return;
    }

    if (!settings.store.enabled) {
        restoreStatus();
        clearRpc();
        return;
    }

    const track = getCurrentTrack();
    if (!track) {
        lastPlaying = undefined;
        if (!windowsSpotifyActive()) {
            lastKey = "";
            loadingKey = "";
            lines = [];
            restoreStatus();
            clearRpc();
        }
        return;
    }

    prepareTrack(track);

    if (!track.isPlaying) {
        lastPlaying = false;
        updateRpc(track, true);
        switch (settings.store.pausedBehavior) {
            case "lastLyric":
                if (lastDisplayedStatus()) return;
                applySongStatus(track, true);
                return;
            case "restore":
                restoreStatus();
                return;
            case "clear":
                setStatusText("", true);
                return;
            default:
                applySongStatus(track, true);
                return;
        }
    }

    const resumed = lastPlaying === false;
    lastPlaying = true;
    updateRpc(track, false);

    if (track.isPodcast) {
        applySongStatus(track);
        return;
    }

    const cached = cachedLyrics(track);
    if (cached?.lines.length && !lines.length) lines = cached.lines;

    const progress = track.progressMs + offsetMs();
    const line = currentLine(lines, progress, gapMs());
    if (line) {
        const index = lines.indexOf(line);
        setStatusText(lyricPage(line, lines[index + 1]?.timeMs, progress, offsetMs()), resumed);
        return;
    }

    if (loadingKey === lastKey) {
        if (settings.store.showWaitingDots) setStatusText(waitingDots());
        else setStatusText(formatStatus(settings.store.loadingText, false));
        return;
    }

    if (!lines.length) {
        applyNoLyrics(track);
        return;
    }

    if (settings.store.showWaitingDots) setStatusText(waitingDots());
    else applySongStatus(track);
}

function onSpotifyPlayerState(event: { track?: unknown; isPlaying?: boolean; position?: number; }) {
    rememberPlayerEvent(event as Parameters<typeof rememberPlayerEvent>[0]);
    tick();
}

function onUnload() {
    void shutdownStatus();
}

function SettingsAbout() {
    return (
        <>
            <Forms.FormTitle tag="h3">How it works</Forms.FormTitle>
            <Paragraph className={Margins.bottom8}>
                SpotifyLyricsStatus reads the song Discord already knows from your connected Spotify account,
                looks up synced lyrics, and writes the current line to your custom status.
            </Paragraph>
            <Paragraph>
                Connect Spotify in Discord Settings → Connections and make sure Spotify activity is visible.
                Frequent custom status updates can be against Discord’s Terms of Service. Use at your own risk.
            </Paragraph>
        </>
    );
}

export default definePlugin({
    name: "SpotifyLyricsStatus",
    description: "Show synced Spotify lyrics in your Discord custom status.",
    authors: [{ name: "ilyau", id: 0n }],
    tags: ["Spotify", "Lyrics", "Status", "Media"],
    dependencies: ["SpotifyControls", "UserSettingsAPI"],
    settings,
    settingsAboutComponent: SettingsAbout,

    flux: {
        SPOTIFY_PLAYER_STATE(event: { track?: unknown; isPlaying?: boolean; position?: number; }) {
            onSpotifyPlayerState(event);
        }
    },

    start() {
        onRpcAsset(() => tick());
        window.addEventListener("beforeunload", onUnload);
        void captureOriginalStatus().then(() => {
            void pollWindowsSpotify(true);
            timer = setInterval(tick, 250);
            tick();
        });
    },

    stop() {
        if (timer) clearInterval(timer);
        timer = undefined;
        window.removeEventListener("beforeunload", onUnload);
        lastKey = "";
        loadingKey = "";
        lines = [];
        lastPlaying = undefined;
        void shutdownStatus().finally(() => {
            resetStatusRuntime();
            forgetOriginalStatus();
        });
        clearRpc();
    }
});
