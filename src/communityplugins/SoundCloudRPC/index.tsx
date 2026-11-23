/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { ActivityType } from "@vencord/discord-types/enums";
import { ApplicationAssetUtils, FluxDispatcher } from "@webpack/common";

declare const VencordNative: {
    pluginHelpers: {
        SoundCloudRPC: {
            start(port: number): Promise<void>;
            stop(): Promise<void>;
            getState(): Promise<{
                track: {
                    id: string;
                    title: string;
                    artist: string;
                    duration: number;
                    thumbnail?: string;
                    permalink?: string;
                } | null;
                isPlaying: boolean;
                position: number;
                _ts: number;
            } | null>;
            setActivity(
                clientId: string,
                activity: object | null,
            ): Promise<void>;
        };
    };
};

const SOCKET_ID = "SoundCloudRPC";
const CLEAR_DEBOUNCE_TICKS = 3;

const settings = definePluginSettings({
    appId: {
        type: OptionType.STRING,
        description: "Discord application ID.",
        default: "",
        placeholder: "",
        isValid: (v: string) =>
            !v ||
            /^\d{17,20}$/.test(v) ||
            "Must be a Discord snowflake (17-20 digits)",
    },
    port: {
        type: OptionType.NUMBER,
        description: "Local HTTP port the userscript posts track state to.",
        default: 38291,
    },
    showButton: {
        type: OptionType.BOOLEAN,
        description: "Show button linking to the track on SoundCloud.",
        default: true,
    },
    buttonText: {
        type: OptionType.STRING,
        description: "Button label.",
        default: "listen",
        placeholder: "listen",
    },
    idleTimeoutSec: {
        type: OptionType.NUMBER,
        description:
            "Clear RPC if no state update received within this many seconds.",
        default: 10,
    },
});

type State = NonNullable<
    Awaited<
        ReturnType<typeof VencordNative.pluginHelpers.SoundCloudRPC.getState>
    >
>;

async function buildLocalActivity(state: State) {
    const { track, position, isPlaying } = state;
    if (!track) return null;

    const { appId } = settings.store;
    const now = Date.now();

    let large_image: string | undefined;
    if (track.thumbnail) {
        try {
            const ids = await Promise.race([
                ApplicationAssetUtils.fetchAssetIds(appId, [track.thumbnail]),
                new Promise<never>((_, reject) => setTimeout(reject, 3000)),
            ]);
            large_image = (ids as string[])[0];
        } catch {}
    }

    return {
        application_id: appId,
        name: track.title,
        type: ActivityType.LISTENING,
        details: track.title,
        state: track.artist ? `by ${track.artist}` : undefined,
        flags: 1 << 0,
        timestamps:
            isPlaying && track.duration > 0
                ? {
                      start: Math.floor(now - position),
                      end: Math.floor(now + (track.duration - position)),
                  }
                : undefined,
        assets: large_image ? { large_image } : undefined,
        buttons:
            settings.store.showButton && track.permalink
                ? [settings.store.buttonText || "listen"]
                : undefined,
        metadata:
            settings.store.showButton && track.permalink
                ? { button_urls: [track.permalink] }
                : undefined,
    };
}

function buildPipeActivity(state: State) {
    const { track, position, isPlaying } = state;
    if (!track) return null;

    const now = Date.now();
    return {
        name: track.title,
        type: ActivityType.LISTENING,
        details: track.title,
        state: track.artist ? `by ${track.artist}` : undefined,
        timestamps:
            isPlaying && track.duration > 0
                ? {
                      start: Math.floor(now - position),
                      end: Math.floor(now + (track.duration - position)),
                  }
                : undefined,
        assets: track.thumbnail ? { large_image: track.thumbnail } : undefined,
        buttons:
            settings.store.showButton && track.permalink
                ? [{ label: settings.store.buttonText || "listen", url: track.permalink }]
                : undefined,
        instance: false,
    };
}

let _stop = false;
let _lastDispatchedKey = "";
let _lastPosition = 0;
let _lastDispatchedAt = 0;
let _clearStreak = 0;
const SEEK_THRESHOLD_MS = 3000;

function stateKey(s: State | null) {
    if (!s?.track) return "null";
    return `${s.track.id}|${s.isPlaying}`;
}

async function tick() {
    if (_stop) return;
    try {
        const state =
            await VencordNative.pluginHelpers.SoundCloudRPC.getState();
        const idleMs = settings.store.idleTimeoutSec * 1000;
        const fresh = state && Date.now() - state._ts < idleMs ? state : null;
        const active = fresh?.track && fresh.isPlaying ? fresh : null;

        if (active && !settings.store.appId) {
            if (_lastDispatchedKey !== "no-app-id") {
                _lastDispatchedKey = "no-app-id";
                console.warn(
                    "[SoundCloudRPC] appId not set in plugin settings — RPC disabled",
                );
            }
        } else if (active) {
            _clearStreak = 0;
            const key = stateKey(active);
            const expectedPos =
                _lastPosition + (Date.now() - _lastDispatchedAt);
            const seekDetected =
                key === _lastDispatchedKey &&
                Math.abs(active.position - expectedPos) > SEEK_THRESHOLD_MS;
            if (key !== _lastDispatchedKey || seekDetected) {
                _lastDispatchedKey = key;
                _lastPosition = active.position;
                _lastDispatchedAt = Date.now();
                const local = await buildLocalActivity(active);
                FluxDispatcher.dispatch({
                    type: "LOCAL_ACTIVITY_UPDATE",
                    activity: local,
                    socketId: SOCKET_ID,
                });
                VencordNative.pluginHelpers.SoundCloudRPC.setActivity(
                    settings.store.appId,
                    buildPipeActivity(active),
                );
            }
        } else {
            _clearStreak++;
            if (
                _clearStreak >= CLEAR_DEBOUNCE_TICKS &&
                _lastDispatchedKey !== "null"
            ) {
                _lastDispatchedKey = "null";
                FluxDispatcher.dispatch({
                    type: "LOCAL_ACTIVITY_UPDATE",
                    activity: null,
                    socketId: SOCKET_ID,
                });
                VencordNative.pluginHelpers.SoundCloudRPC.setActivity("", null);
            }
        }
    } catch (e) {
        console.error("[SoundCloudRPC] tick failed:", e);
    }
    setTimeout(tick, 1000);
}

export default definePlugin({
    name: "SoundCloudRPC",
    description: "SoundCloud Discord rich presence",
    authors: [{ name: "relony", id: 377696457890988033n }],
    settings,

    patches: [
        {
            find: ".USER_PROFILE_ACTIVITY_BUTTONS),",
            replacement: {
                match: /.getId\(\)===\i.id/,
                replace: "$& && false",
            },
        },
    ],

    async start() {
        _stop = false;
        _lastDispatchedKey = "";
        try {
            await VencordNative.pluginHelpers.SoundCloudRPC.start(
                settings.store.port,
            );
        } catch (e) {
            console.error("[SoundCloudRPC] native start failed:", e);
            return;
        }
        tick();
    },

    stop() {
        _stop = true;
        FluxDispatcher.dispatch({
            type: "LOCAL_ACTIVITY_UPDATE",
            activity: null,
            socketId: SOCKET_ID,
        });
        VencordNative.pluginHelpers.SoundCloudRPC.setActivity("", null);
        VencordNative.pluginHelpers.SoundCloudRPC.stop();
    },
});
