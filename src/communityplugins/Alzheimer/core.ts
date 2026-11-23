/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const HOUR = 60 * 60 * 1000;
export const REMINDER_INTERVAL = 2 * HOUR;

export interface Activity {
    messageId: string;
    timestamp: number;
    authorId?: string;
}

export interface Reminder {
    messageId: string;
    sentAt: number;
}

export type ReminderHistory = Record<string, Reminder>;

export function activityColor(timestamp: number, now: number) {
    const age = Math.max(0, now - timestamp);
    if (age >= 72 * HOUR) return "red";
    if (age >= 48 * HOUR) return "yellow";
    if (age >= 24 * HOUR) return "green";
    return "neutral";
}

export function reminderDue(activity: Activity, userId: string, previous: Reminder | undefined, now: number): number | null {
    if (!activity.authorId || activity.authorId === userId || now >= activity.timestamp + 72 * HOUR) return null;
    const first = activity.timestamp + 48 * HOUR;
    return previous?.messageId === activity.messageId
        ? Math.max(first, previous.sentAt + REMINDER_INTERVAL)
        : first;
}

export function newestId(ids: (string | null | undefined)[], deleted: ReadonlySet<string>) {
    return ids.reduce<string | undefined>((latest, id) => {
        if (!id || deleted.has(id)) return latest;
        return !latest || BigInt(id) > BigInt(latest) ? id : latest;
    }, undefined);
}

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "always" });

export function elapsedLabel(timestamp: number, now: number) {
    const minutes = Math.floor(Math.max(0, now - timestamp) / 60000);
    if (minutes === 0) return "Just now";
    return minutes < 60
        ? relativeTime.format(-minutes, "minute")
        : relativeTime.format(-Math.floor(minutes / 60), "hour");
}
