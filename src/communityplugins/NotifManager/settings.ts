/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";
import { React } from "@webpack/common";

import { AdvancedSection, ListManagerSection, QuickActionsSection, SuppressedHistorySection } from "./NotifManager";

export default definePluginSettings({
    quickActions: {
        type: OptionType.COMPONENT,
        description: "Quick mute toggles",
        component: () => React.createElement(QuickActionsSection, null)
    },
    mode: {
        type: OptionType.SELECT,
        description: "Whether to use whitelist or blacklist mode",
        options: [
            { label: "Whitelist", value: "whitelist" },
            { label: "Blacklist", value: "blacklist", default: true }
        ]
    },
    listManager: {
        type: OptionType.COMPONENT,
        description: "Manage notification sources",
        component: () => React.createElement(ListManagerSection, null)
    },
    advanced: {
        type: OptionType.COMPONENT,
        description: "Advanced settings",
        component: () => React.createElement(AdvancedSection, null)
    },
    suppressedHistory: {
        type: OptionType.COMPONENT,
        description: "View suppressed notification history",
        component: () => React.createElement(SuppressedHistorySection, null)
    },
    muteAllDMs: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Suppress all direct message notifications",
        hidden: true
    },
    muteAllGCs: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Suppress all group chat notifications",
        hidden: true
    },
    muteAllServers: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Suppress all server notifications",
        hidden: true
    },
    muteAllSounds: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Mute all Discord notification sounds globally",
        hidden: true
    },
    muteAllPopups: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Suppress all Discord desktop notification popups globally",
        hidden: true
    },
    quietHoursEnabled: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Enable quiet hours",
        hidden: true
    },
    quietHoursStart: {
        type: OptionType.STRING,
        default: "22:00",
        description: "Quiet hours start time in HH:MM 24-hour format",
        hidden: true
    },
    quietHoursEnd: {
        type: OptionType.STRING,
        default: "08:00",
        description: "Quiet hours end time in HH:MM 24-hour format",
        hidden: true
    },
    quietHoursAllowMentions: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Allow notifications for @mentions during quiet hours",
        hidden: true
    },
    quietHoursAllowDirectMessages: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Allow DMs during quiet hours",
        hidden: true
    },
    quietHoursExceptions: {
        type: OptionType.STRING,
        default: "",
        description: "Comma-separated server or channel IDs that bypass quiet hours suppression regardless of blacklist status",
        hidden: true
    },
    vipUsers: {
        type: OptionType.STRING,
        default: "",
        description: "Comma-separated user IDs that bypass all suppression",
        hidden: true
    },
    keywordMode: {
        type: OptionType.SELECT,
        description: "Whether matched keywords suppress or allow notifications",
        options: [
            { label: "Suppress", value: "suppress", default: true },
            { label: "Allow Only", value: "allow" }
        ],
        hidden: true
    },
    keywords: {
        type: OptionType.STRING,
        default: "",
        description: "Comma-separated keywords to match against message content",
        hidden: true
    }
});
