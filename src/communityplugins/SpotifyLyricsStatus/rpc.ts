/**
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ilyau and contributors
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { PluginNative } from "@utils/types";
import { Activity } from "@vencord/discord-types";
import { ActivityFlags, ActivityStatusDisplayType, ActivityType } from "@vencord/discord-types/enums";
import { ApplicationAssetUtils, FluxDispatcher } from "@webpack/common";

import { settings } from "./settings";
import { Track } from "./types";
import { cleanText, durationMs, firstArtist, trackKey } from "./utils";

const logger = new Logger("SpotifyLyricsStatus");
const Native = VencordNative.pluginHelpers.SpotifyLyricsStatus as PluginNative<typeof import("./native")> | undefined;
const RPC_SOCKET = "SpotifyLyricsStatus.rpc";

const resolvedAssets = new Map<string, string | undefined>();
const pendingAssets = new Map<string, Promise<string | undefined>>();
const fallbackImages = new Map<string, string | undefined>();
const fallbackRequests = new Map<string, Promise<string | undefined>>();

let lastKey = "";
let lastStartedAt = 0;
let onAsset: (() => void) | undefined;

export function onRpcAsset(callback: () => void) {
    onAsset = callback;
}

function debug(message: string) {
    if (settings.store.debugLog) logger.info(message);
}

function spotifyAsset(url: string) {
    const match = cleanText(url).match(/^https?:\/\/i\.scdn\.co\/image\/([a-z0-9]+)$/i);
    return match ? `spotify:${match[1]}` : undefined;
}

function fallbackKey(track: Track) {
    return `${track.title}|${firstArtist(track.artist)}|${track.album}`.toLowerCase();
}

async function lookupFallbackImage(track: Track) {
    const key = fallbackKey(track);
    if (fallbackImages.has(key)) return fallbackImages.get(key);
    if (fallbackRequests.has(key)) return fallbackRequests.get(key);

    const pending = (async () => {
        try {
            const url = Native?.searchAlbumImage
                ? cleanText(await Native.searchAlbumImage(track.title, track.artist, track.album))
                : "";
            fallbackImages.set(key, url || undefined);
            return url || undefined;
        } catch (error) {
            debug(`album fallback failed ${String(error)}`);
            fallbackImages.set(key, undefined);
            return undefined;
        } finally {
            fallbackRequests.delete(key);
        }
    })();

    fallbackRequests.set(key, pending);
    return pending;
}

function resolveAsset(url: string) {
    const direct = spotifyAsset(url);
    if (direct) return direct;
    if (resolvedAssets.has(url)) return resolvedAssets.get(url);
    if (pendingAssets.has(url)) return undefined;

    const pending = ApplicationAssetUtils.fetchAssetIds("0", [url])
        .then(ids => {
            resolvedAssets.set(url, ids[0]);
            onAsset?.();
            return ids[0];
        })
        .catch(error => {
            logger.warn("Could not register album art", error);
            resolvedAssets.set(url, undefined);
            return undefined;
        })
        .finally(() => pendingAssets.delete(url));

    pendingAssets.set(url, pending);
    return undefined;
}

export function clearRpc() {
    if (!lastKey) return;
    lastKey = "";
    lastStartedAt = 0;
    FluxDispatcher.dispatch({
        type: "LOCAL_ACTIVITY_UPDATE",
        activity: null,
        socketId: RPC_SOCKET
    });
}

export function updateRpc(track: Track | undefined, paused = false) {
    if (!settings.store.enableRpc || !track || (paused && !settings.store.rpcShowWhenPaused)) {
        clearRpc();
        return;
    }

    let imageUrl = settings.store.rpcShowAlbumArt ? track.albumImage : "";
    if (settings.store.rpcShowAlbumArt && !imageUrl) {
        const cached = fallbackImages.get(fallbackKey(track));
        if (cached) imageUrl = cached;
        else void lookupFallbackImage(track).then(url => {
            if (url) onAsset?.();
        });
    }

    const largeImage = imageUrl ? resolveAsset(imageUrl) : undefined;
    const duration = durationMs(track.durationMs);
    const progress = Math.max(0, duration ? Math.min(track.progressMs, duration) : track.progressMs);
    const now = Date.now();
    const startedAt = paused || !duration ? 0 : now - progress;
    const key = `${trackKey(track)}|${paused}|${largeImage ?? ""}|${duration}`;
    const drift = startedAt && lastStartedAt ? Math.abs(startedAt - lastStartedAt) : 0;
    if (key === lastKey && (!startedAt || drift < 4000)) return;

    lastKey = key;
    lastStartedAt = startedAt;

    const activity: Activity = {
        application_id: "0",
        name: cleanText(settings.store.rpcName) || "Spotify",
        details: paused ? `${settings.store.pausedPrefix}${track.title}` : track.title,
        state: track.album && track.artist ? `${track.artist} — ${track.album}` : track.artist,
        type: ActivityType.LISTENING,
        timestamps: paused || !duration ? undefined : {
            start: startedAt,
            end: startedAt + duration
        },
        assets: largeImage ? {
            large_image: largeImage,
            large_text: track.album || track.title
        } : undefined,
        status_display_type: ActivityStatusDisplayType.DETAILS,
        flags: ActivityFlags.INSTANCE
    };

    FluxDispatcher.dispatch({
        type: "LOCAL_ACTIVITY_UPDATE",
        activity,
        socketId: RPC_SOCKET
    });
    debug(`rpc ${paused ? "paused" : "playing"} "${track.title}"`);
}
