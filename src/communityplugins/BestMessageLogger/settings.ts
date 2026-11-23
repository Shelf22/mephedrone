/*
 * BestMessageLogger, a Vencord plugin by Kh8da
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { applyDeleteStyle } from "./styles";

export const settings = definePluginSettings({
    deleteStyle: {
        type: OptionType.SELECT,
        description: "How deleted messages look in chat.",
        options: [
            { label: "Red text", value: "text", default: true },
            { label: "Red overlay", value: "overlay" }
        ],
        onChange: () => applyDeleteStyle()
    },
    logDeletes: {
        type: OptionType.BOOLEAN,
        description: "Keep deleted messages visible in chat and log them.",
        default: true
    },
    restoreDeletedInChat: {
        type: OptionType.BOOLEAN,
        description: "Show logged deleted messages in chat again after switching channels, reloading or restarting Discord.",
        default: true
    },
    collapseDeleted: {
        type: OptionType.BOOLEAN,
        description: "Collapse deleted messages, like blocked messages.",
        default: false,
        restartNeeded: true
    },
    logEdits: {
        type: OptionType.BOOLEAN,
        description: "Track message edits.",
        default: true
    },
    logDeletedAttachments: {
        type: OptionType.BOOLEAN,
        description: "Keep attachments that were removed from a message by an edit.",
        default: true,
        restartNeeded: true
    },
    inlineEdits: {
        type: OptionType.BOOLEAN,
        description: "Show edit history directly below messages in chat.",
        default: true
    },
    logGhostPings: {
        type: OptionType.BOOLEAN,
        description: "Track deleted or edited messages that pinged you.",
        default: true
    },
    saveMedia: {
        type: OptionType.BOOLEAN,
        description: "Save images, videos, audio and files of deleted messages on this computer, so they still open after Discord removes them.",
        default: true
    },
    cacheMedia: {
        type: OptionType.BOOLEAN,
        description: "Keep a temporary copy of the media in channels you open and in your DMs. Discord removes files the moment a message is deleted, so this is what makes saving them reliable.",
        default: true
    },
    mediaCacheMB: {
        type: OptionType.SLIDER,
        description: "Disk space (in MB) the temporary media cache may use. The oldest files are removed first, and nothing is kept longer than 7 days.",
        default: 512,
        markers: [128, 256, 512, 1024, 2048],
        stickToMarkers: true
    },
    maxMediaSizeMB: {
        type: OptionType.SLIDER,
        description: "Largest single file (in MB) to save from a deleted message.",
        default: 25,
        markers: [5, 10, 25, 50, 100],
        stickToMarkers: true
    },
    ignoreBots: {
        type: OptionType.BOOLEAN,
        description: "Ignore messages from bots.",
        default: false
    },
    ignoreSelf: {
        type: OptionType.BOOLEAN,
        description: "Ignore your own messages.",
        default: false
    },
    ignoreUsers: {
        type: OptionType.STRING,
        description: "Comma-separated list of user IDs to ignore.",
        default: "",
        multiline: true
    },
    ignoreChannels: {
        type: OptionType.STRING,
        description: "Comma-separated list of channel or category IDs to ignore.",
        default: "",
        multiline: true
    },
    ignoreGuilds: {
        type: OptionType.STRING,
        description: "Comma-separated list of server IDs to ignore.",
        default: "",
        multiline: true
    },
    savedLimit: {
        type: OptionType.SLIDER,
        description: "Maximum log entries kept per tab.",
        default: 1000,
        markers: [100, 250, 500, 1000, 2500, 5000],
        stickToMarkers: true
    },
    retentionDays: {
        type: OptionType.SLIDER,
        description: "Remove log entries older than this many days.",
        default: 30,
        markers: [1, 3, 7, 14, 30, 90, 365],
        stickToMarkers: true
    },
    openHotkey: {
        type: OptionType.STRING,
        description: "Hotkey that opens the log menu, for example Ctrl+Shift+I",
        default: "Ctrl+Shift+I"
    }
});

/** Splits a comma separated id list from the settings. */
export function parseIdList(input: string | undefined): string[] {
    return (input ?? "").split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
}
