/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { Settings, SettingsStore } from "@api/Settings";
import { PinOrder, settings as pinSettings } from "@plugins/pinDms";
import { Logger } from "@utils/Logger";
import { ChannelStore, Constants, MessageStore, NavigationRouter, ReadStateStore, RelationshipStore, RestAPI, SnowflakeUtils, UserStore } from "@webpack/common";

import { ActivityStore, pinnedIds } from "./activity";
import { Activity, elapsedLabel, reminderDue, ReminderHistory } from "./core";

const logger = new Logger("Alzheimer");
const sources = () => [ChannelStore, MessageStore, ReadStateStore, UserStore];
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let epoch = 0;
let account: string | undefined;
let history: ReminderHistory | undefined;
let busy: number | undefined;
let dirty = false;
let nextFetchAt = 0;
const attempted = new Set<string>();

export function refresh() {
    if (!running) return;
    if (busy === epoch) {
        dirty = true;
        return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => void synchronize(), 50);
}

export function reconnect() {
    attempted.clear();
    refresh();
}

function settingsChanged(_: unknown, path: string) {
    if (path.startsWith("plugins.PinDMs.") || path === "plugins.Alzheimer.enableReminders") refresh();
}

function isCurrent(userId: string, generation: number) {
    return running && epoch === generation && UserStore.getCurrentUser()?.id === userId;
}

function parseActivity(body: unknown): Activity | null {
    if (!Array.isArray(body) || body.length === 0) return null;
    const message: unknown = body[0];
    if (typeof message !== "object" || message === null || !("id" in message) || !("author" in message)) return null;
    if (typeof message.author !== "object" || message.author === null || !("id" in message.author)) return null;
    if (typeof message.id !== "string" || typeof message.author?.id !== "string") return null;
    return { messageId: message.id, authorId: message.author.id, timestamp: SnowflakeUtils.extractTimestamp(message.id) };
}

async function notify(channelId: string, activity: Activity, userId: string, generation: number) {
    let claimed = false;
    const key = `Alzheimer:reminders:${userId}`;
    await DataStore.update<ReminderHistory>(key, previous => {
        const records = previous ?? {};
        const current = ActivityStore.getActivity(channelId);
        if (!isCurrent(userId, generation) || !Settings.plugins.Alzheimer.enableReminders || !pinnedIds(userId).includes(channelId) || current?.messageId !== activity.messageId) return records;
        const now = Date.now();
        const due = reminderDue(current, userId, records[channelId], now);
        if (due === null || due > now) return records;
        claimed = true;
        return { ...records, [channelId]: { messageId: current.messageId, sentAt: now } };
    });
    if (!isCurrent(userId, generation)) return;
    const records = await DataStore.get<ReminderHistory>(key) ?? {};
    if (!isCurrent(userId, generation)) return;
    history = records;
    if (!claimed) return;
    const current = ActivityStore.getActivity(channelId);
    if (!Settings.plugins.Alzheimer.enableReminders || !pinnedIds(userId).includes(channelId) || current?.messageId !== activity.messageId || reminderDue(current, userId, undefined, Date.now()) === null) return;
    const recipient = ChannelStore.getChannel(channelId)?.getRecipientId();
    const user = recipient ? UserStore.getUser(recipient) : undefined;
    const name = recipient && RelationshipStore.getNickname(recipient) || user?.globalName || user?.username || "Your friend";
    void showNotification({
        title: `${name} is waiting for your reply`,
        body: `Your last exchange was ${elapsedLabel(activity.timestamp, Date.now())}.`,
        onClick: () => {
            if (UserStore.getCurrentUser()?.id === userId) NavigationRouter.transitionTo(`/channels/@me/${channelId}`);
        }
    }).catch(error => logger.error("Could not show a reminder.", error));
}

async function synchronize() {
    if (!running || busy === epoch) return;
    busy = epoch;
    dirty = false;
    const generation = epoch;
    let next = Infinity;
    try {
        const userId = UserStore.getCurrentUser()?.id;
        if (userId !== account) {
            account = userId;
            history = undefined;
            attempted.clear();
            ActivityStore.reset(true);
        }
        if (!userId) return;
        if (!history) {
            const loaded = await DataStore.get<ReminderHistory>(`Alzheimer:reminders:${userId}`);
            if (!isCurrent(userId, generation)) return;
            history = loaded ?? {};
        }
        for (const channelId of pinnedIds(userId)) {
            if (!isCurrent(userId, generation)) return;
            let activity = ActivityStore.getActivity(channelId);
            const requestKey = `${channelId}:${activity?.messageId ?? "empty"}`;
            if (ActivityStore.needsFetch(channelId) && !attempted.has(requestKey)) {
                if (Date.now() < nextFetchAt) {
                    next = Math.min(next, nextFetchAt);
                } else {
                    attempted.add(requestKey);
                    nextFetchAt = Date.now() + 1500;
                    try {
                        const response = await RestAPI.get({
                            url: Constants.Endpoints.MESSAGES(channelId),
                            query: { limit: 1 },
                            retries: 1
                        });
                        if (!isCurrent(userId, generation)) return;
                        if (!pinnedIds(userId).includes(channelId)) continue;
                        ActivityStore.receive(channelId, parseActivity(response.body));
                        activity = ActivityStore.getActivity(channelId);
                    } catch (error) {
                        logger.warn("Could not load the latest DM sender. Reconnecting will retry.", error);
                    }
                }
            }
            if (!activity || !Settings.plugins.Alzheimer.enableReminders) continue;
            let due = reminderDue(activity, userId, history[channelId], Date.now());
            if (due !== null && due <= Date.now()) {
                await notify(channelId, activity, userId, generation);
                if (!isCurrent(userId, generation)) return;
                due = reminderDue(activity, userId, history[channelId], Date.now());
            }
            if (due !== null) next = Math.min(next, due);
        }
    } catch (error) {
        logger.error("Could not update reminders.", error);
        next = Date.now() + 60000;
    } finally {
        if (busy === generation) busy = undefined;
        if (running && epoch === generation) {
            if (dirty) refresh();
            else if (Number.isFinite(next)) timer = setTimeout(() => void synchronize(), Math.max(50, next - Date.now()));
        }
    }
}

export function startReminders() {
    running = true;
    epoch++;
    account = undefined;
    history = undefined;
    nextFetchAt = 0;
    attempted.clear();
    ActivityStore.reset(true);
    pinSettings.store.pinOrder = PinOrder.Custom;
    for (const source of sources()) source.addChangeListener(refresh);
    ActivityStore.addChangeListener(refresh);
    SettingsStore.addGlobalChangeListener(settingsChanged);
    refresh();
}

export function stopReminders() {
    running = false;
    epoch++;
    clearTimeout(timer);
    for (const source of sources()) source.removeChangeListener(refresh);
    ActivityStore.removeChangeListener(refresh);
    SettingsStore.removeGlobalChangeListener(settingsChanged);
    ActivityStore.reset(false);
}
