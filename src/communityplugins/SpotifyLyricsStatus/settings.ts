/**
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ilyau and contributors
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Update Discord custom status with the current lyric line",
        default: true
    },
    statusEmoji: {
        type: OptionType.STRING,
        description: "Optional unicode emoji shown with the custom status",
        default: "🎵"
    },
    prefix: {
        type: OptionType.STRING,
        description: "Optional text prefix before each lyric line",
        default: ""
    },
    fontStyle: {
        type: OptionType.SELECT,
        description: "Text style for lyric statuses",
        options: [
            { label: "Normal", value: "normal", default: true },
            { label: "Title Case", value: "title" },
            { label: "UPPERCASE", value: "uppercase" },
            { label: "lowercase", value: "lowercase" },
            { label: "W i d e", value: "wide" },
            { label: "Ｆｕｌｌｗｉｄｔｈ", value: "fullwidth" },
            { label: "𝗕𝗼𝗹𝗱", value: "bold" },
            { label: "𝐼𝑡𝑎𝑙𝑖𝑐", value: "italic" },
            { label: "sᴍᴀʟʟ ᴄᴀᴘs", value: "smallCaps" }
        ]
    },
    lyricOffsetMs: {
        type: OptionType.SLIDER,
        description: "Lyric sync offset. Positive values show the next line earlier",
        markers: [-2000, -1000, -500, 0, 500, 650, 1000, 2000],
        default: 650,
        stickToMarkers: false
    },
    gapThresholdMs: {
        type: OptionType.SLIDER,
        description: "Treat a gap longer than this as instrumental and show waiting dots or song fallback",
        markers: [2000, 3000, 4000, 6000, 8000, 12000],
        default: 4000,
        stickToMarkers: false
    },
    maxStatusLength: {
        type: OptionType.SLIDER,
        description: "Maximum custom status length (Discord limit is 128)",
        markers: [32, 48, 64, 80, 96, 112, 128],
        default: 128,
        stickToMarkers: true
    },
    pausedBehavior: {
        type: OptionType.SELECT,
        description: "What to show while Spotify is paused",
        options: [
            { label: "Song title", value: "song", default: true },
            { label: "Keep last lyric", value: "lastLyric" },
            { label: "Restore your original status", value: "restore" },
            { label: "Clear custom status", value: "clear" }
        ]
    },
    noLyricsBehavior: {
        type: OptionType.SELECT,
        description: "What to show when synced lyrics are missing",
        options: [
            { label: "Song - Artist", value: "song", default: true },
            { label: "Loading / no lyrics text", value: "message" },
            { label: "Waiting dots", value: "dots" },
            { label: "Leave status unchanged", value: "keep" }
        ]
    },
    usePlainLyricsFallback: {
        type: OptionType.BOOLEAN,
        description: "If synced lyrics are missing, time unsynced lyrics across the track",
        default: true
    },
    showWaitingDots: {
        type: OptionType.BOOLEAN,
        description: "Show animated dots between verses and while lyrics load",
        default: true
    },
    loadingText: {
        type: OptionType.STRING,
        description: "Status text while lyrics are loading",
        default: "loading lyrics..."
    },
    noLyricsText: {
        type: OptionType.STRING,
        description: "Status text when no lyrics were found",
        default: "no synced lyrics"
    },
    pausedPrefix: {
        type: OptionType.STRING,
        description: "Prefix for paused song status",
        default: "Pause — "
    },
    restoreOnStop: {
        type: OptionType.BOOLEAN,
        description: "Restore the previous custom status when the plugin stops or Spotify is idle",
        default: true
    },
    lyricsProvider: {
        type: OptionType.SELECT,
        description: "Primary lyrics source. Others are used as fallback",
        options: [
            { label: "LRCLIB, then Deezer, then NetEase", value: "auto", default: true },
            { label: "LRCLIB only", value: "lrclib" },
            { label: "Deezer, then LRCLIB", value: "deezer" },
            { label: "NetEase, then LRCLIB", value: "netease" }
        ]
    },
    enableRpc: {
        type: OptionType.BOOLEAN,
        description: "Also show a Listening rich presence card for the current song",
        default: false
    },
    rpcName: {
        type: OptionType.STRING,
        description: "Rich presence application name",
        default: "Spotify"
    },
    rpcShowWhenPaused: {
        type: OptionType.BOOLEAN,
        description: "Keep rich presence visible while paused",
        default: true
    },
    rpcShowAlbumArt: {
        type: OptionType.BOOLEAN,
        description: "Show album art on rich presence",
        default: true
    },
    debugLog: {
        type: OptionType.BOOLEAN,
        description: "Log track, lyric, and status updates to the console",
        default: false
    }
});
