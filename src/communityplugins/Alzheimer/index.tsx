/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { DecoratorProps } from "@api/MemberListDecorators";
import { definePluginSettings, useSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { useTimer } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, MessageStore, ReadStateStore, Tooltip, UserStore, useStateFromStores } from "@webpack/common";

import { ActivityStore, pinnedIds } from "./activity";
import { activityColor, elapsedLabel } from "./core";
import { reconnect, refresh, startReminders, stopReminders } from "./reminders";

const cl = classNameFactory("vc-alzheimer-");
const pinPaths: ["plugins.PinDMs.userBasedCategoryList"] = ["plugins.PinDMs.userBasedCategoryList"];

const settings = definePluginSettings({
    enableReminders: {
        type: OptionType.BOOLEAN,
        displayName: "Enable reminders",
        description: "Remind you every two hours while a pinned DM is yellow and waiting for your reply.",
        default: true
    }
});

function ActivityBadge({ channel, type }: DecoratorProps) {
    useSettings(pinPaths);
    useTimer({ interval: 60000 });
    const userId = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id);
    const enabled = useStateFromStores([ActivityStore], () => ActivityStore.enabled);
    const activity = useStateFromStores([ActivityStore, ChannelStore, MessageStore, ReadStateStore], () => channel && ActivityStore.getActivity(channel.id), [channel?.id], (a, b) => a?.messageId === b?.messageId && a?.authorId === b?.authorId);
    if (!enabled || type !== "dm" || !channel?.isDM() || !pinnedIds(userId).includes(channel.id) || !activity) return null;
    const now = Date.now();
    const waiting = Boolean(userId && activity.authorId && activity.authorId !== userId);
    const label = elapsedLabel(activity.timestamp, now);
    const tooltip = `${waiting ? "Waiting for your reply. " : ""}Last message: ${new Date(activity.timestamp).toLocaleString("en-US")}.${!activity.authorId ? " Latest sender is unavailable." : ""}`;
    return (
        <Tooltip text={tooltip}>
            {props => (
                <span {...props} className={cl("badge", activityColor(activity.timestamp, now))} aria-label={`${label}${waiting ? ". Waiting for your reply" : ""}`}>
                    <span className={cl("time")}>{label}</span>
                    {waiting && (
                        <svg className={cl("reply")} width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M10 5a1 1 0 0 1 1 1v3h3a7 7 0 0 1 7 7v2a1 1 0 0 1-2 0v-2a5 5 0 0 0-5-5h-3v3a1 1 0 0 1-1.64.77l-6-5a1 1 0 0 1 0-1.54l6-5A1 1 0 0 1 10 5Z" />
                        </svg>
                    )}
                </span>
            )}
        </Tooltip>
    );
}

const SafeActivityBadge = ErrorBoundary.wrap(ActivityBadge, { noop: true });

export default definePlugin({
    name: "Alzheimer",
    description: "Keep pinned DMs in view, track inactivity, and remind you when a friend is waiting for your reply.",
    authors: [{ name: "TheRealMagyar", id: 462651633709613056n }],
    dependencies: ["PinDMs", "MemberListDecoratorsAPI"],
    settings,
    renderMemberListDecorator: props => <SafeActivityBadge {...props} />,
    start: startReminders,
    stop: stopReminders,
    flux: {
        CONNECTION_OPEN: reconnect,
        MESSAGE_DELETE({ channelId, id }: { channelId: string; id: string; }) {
            if (ActivityStore.removeMessages(channelId, [id])) reconnect();
        },
        MESSAGE_DELETE_BULK({ channelId, ids }: { channelId: string; ids: string[]; }) {
            if (ActivityStore.removeMessages(channelId, ids)) reconnect();
        },
        LOGOUT: refresh
    }
});
