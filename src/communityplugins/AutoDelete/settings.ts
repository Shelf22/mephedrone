/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 KernelSpecter
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { MAX_TTL, MIN_TTL, parseDuration } from "./duration";

export type ScopeMode = "everywhere" | "guilds" | "dms" | "listed";
export type ChainMode = "off" | "burst" | "chain";

/** Channel or guild id -> timer in seconds. 0 means "never delete anything here". */
export type RuleMap = Record<string, number>;

export function checkDuration(value: string): boolean | string {
    const parsed = parseDuration(value);
    if (parsed == null) return "Not a duration I understand. Try 45s, 10m, 2h or 1d.";
    if (parsed < MIN_TTL) return `Too eager. ${MIN_TTL}s is the floor.`;
    if (parsed > MAX_TTL) return "Too patient. 14d is the ceiling.";
    return true;
}

export const settings = definePluginSettings({
    armed: {
        type: OptionType.BOOLEAN,
        description: "Arm the timer. Turn this off to stop scheduling without losing your rules or the pending queue",
        default: true
    },
    defaultTimer: {
        type: OptionType.STRING,
        description: "How long your messages live by default",
        default: "10m",
        placeholder: "10m",
        isValid: checkDuration
    },
    scope: {
        type: OptionType.SELECT,
        description: "Where the default timer applies. Per-channel rules always win over this",
        options: [
            { label: "Everywhere", value: "everywhere" },
            { label: "Servers only", value: "guilds" },
            { label: "DMs and group DMs only", value: "dms" },
            { label: "Only where I set a rule", value: "listed", default: true }
        ] as const
    },
    jitterPercent: {
        type: OptionType.SLIDER,
        description: "Spread deletions up to this much past the timer, so a burst of messages does not vanish in lockstep",
        markers: [0, 5, 10, 20, 30, 50],
        default: 10,
        stickToMarkers: false
    },
    minIntervalMs: {
        type: OptionType.SLIDER,
        description: "Minimum gap between two deletions. The queue paces itself to this",
        markers: [400, 800, 1200, 2000, 3000, 5000],
        default: 1200,
        stickToMarkers: false
    },

    deleteOnReply: {
        type: OptionType.BOOLEAN,
        description: "Delete one of your messages the moment somebody replies to it",
        default: false
    },
    chainMode: {
        type: OptionType.SELECT,
        description: "How much goes with it when a reply triggers a deletion",
        options: [
            { label: "Just that message", value: "off" },
            { label: "The whole burst it sits in: your run of consecutive messages", value: "burst", default: true },
            { label: "The reply lineage: that message and the ones it was replying to", value: "chain" }
        ] as const
    },
    deleteOnReaction: {
        type: OptionType.BOOLEAN,
        description: "Delete one of your messages once it picks up reactions from other people",
        default: false
    },
    reactionThreshold: {
        type: OptionType.SLIDER,
        description: "How many reactions from other people it takes",
        markers: [1, 2, 3, 5, 10],
        default: 1,
        stickToMarkers: true
    },

    keepMarker: {
        type: OptionType.STRING,
        description: "A message containing this text is never scheduled. Leave empty to disable",
        default: "!keep",
        placeholder: "!keep"
    },
    skipPinned: {
        type: OptionType.BOOLEAN,
        description: "Never delete a pinned message",
        default: true
    },
    skipAttachments: {
        type: OptionType.BOOLEAN,
        description: "Never delete a message you attached a file to",
        default: false
    },

    showCountdown: {
        type: OptionType.BOOLEAN,
        description: "Show a live countdown under each of your pending messages",
        default: true
    },
    dryRun: {
        type: OptionType.BOOLEAN,
        description: "Log what would be deleted and delete nothing. Use this before you trust it with a real channel",
        default: false
    },
    logToConsole: {
        type: OptionType.BOOLEAN,
        description: "Log every deletion to the console",
        default: false
    },
    maxQueueAgeDays: {
        type: OptionType.SLIDER,
        description: "Forget queued messages older than this if Discord was closed when their timer ran out",
        markers: [1, 3, 7, 14],
        default: 7,
        stickToMarkers: true
    },

    /** Not rendered. Written by the context menus and /autodelete here. */
    rules: {
        type: OptionType.CUSTOM,
        default: {} as RuleMap
    }
});
