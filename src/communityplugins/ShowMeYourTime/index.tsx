/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { MessageDecorationProps } from "@api/MessageDecorations";
import { StreamerModeStore } from "@webpack/common";

const settings = definePluginSettings({
    format: {
        type: OptionType.SELECT,
        description: "Time display format",
        options: [
            { label: "12-hour (e.g. 2:30 PM)", value: "12h", default: true },
            { label: "24-hour (e.g. 14:30)", value: "24h" },
        ],
    },
    showSeconds: {
        type: OptionType.BOOLEAN,
        description: "Show seconds in the time display",
        default: false,
    },
    timezones: {
        type: OptionType.STRING,
        description: 'Timezone offsets as JSON, e.g. {"userID":"-05:00"}. Right-click a user > Copy ID to get their ID.',
        default: "{}",
        onChange: (newValue: string) => {
            try {
                const parsed = JSON.parse(newValue);
                for (const [userId, offset] of Object.entries(parsed)) {
                    if (typeof offset !== "string" || !/^[+-]\d{2}:\d{2}$/.test(offset)) {
                        console.error(`ShowMeYourTime: Invalid offset "${offset}" for user "${userId}". Use format like "+05:30" or "-08:00".`);
                    }
                }
            } catch {
                console.error("ShowMeYourTime: Invalid JSON in timezones setting.");
            }
        },
    },
});

function formatTime(date: Date): string {
    const { format, showSeconds } = settings.store;
    const hours = format === "12h"
        ? date.getUTCHours() % 12 || 12
        : date.getUTCHours();
    const m = date.getUTCMinutes().toString().padStart(2, "0");
    const s = showSeconds ? `:${date.getUTCSeconds().toString().padStart(2, "0")}` : "";
    const ampm = format === "12h" ? ` ${date.getUTCHours() >= 12 ? "PM" : "AM"}` : "";

    return `${hours}:${m}${s}${ampm}`;
}

function getLocalTimeForUser(userId: string): string | null {
    try {
        const timezones = JSON.parse(settings.store.timezones);
        const offset = timezones[userId];
        if (!offset) return null;

        const [_, sign, h, m] = offset.match(/^([+-])(\d{2}):(\d{2})$/);
        const totalOffsetMinutes = (sign === "-" ? -1 : 1) * (Number(h) * 60 + Number(m));

        const localTime = new Date(Date.now() + totalOffsetMinutes * 60 * 1000);
        return formatTime(localTime);
    } catch (e) {
        console.error("ShowMeYourTime: Failed to compute local time:", e);
        return null;
    }
}

function Decoration({ message }: MessageDecorationProps) {
    const user = message?.author;
    if (!user) return null;

    if (StreamerModeStore.enabled) return null;

    const localTime = getLocalTimeForUser(user.id);
    if (!localTime) return null;

    return <span className="vc-syt-time">{localTime}</span>;
}

export default definePlugin({
    name: "ShowMeYourTime",
    description: "Display users' local times next to their messages",
    tags: ["Appearance", "Customisation"],
    authors: [Devs.Ven],
    settings,

    renderMessageDecoration: Decoration,
});
