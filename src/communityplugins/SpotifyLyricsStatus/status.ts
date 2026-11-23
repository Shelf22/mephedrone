/**
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ilyau and contributors
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { getUserSettingLazy } from "@api/UserSettings";
import { Logger } from "@utils/Logger";
import { Activity } from "@vencord/discord-types";
import { ActivityFlags, ActivityType } from "@vencord/discord-types/enums";
import { FluxDispatcher } from "@webpack/common";

import { settings } from "./settings";
import { CustomStatusValue } from "./types";
import { cleanText } from "./utils";

const logger = new Logger("SpotifyLyricsStatus");
const CustomStatus = getUserSettingLazy<CustomStatusValue | undefined>("status", "customStatus");
const STATUS_SOCKET = "SpotifyLyricsStatus.custom";
const ORIGINAL_KEY = "SpotifyLyricsStatus.originalCustomStatus";
const LAST_KEY = "SpotifyLyricsStatus.lastWrittenStatus";
const MIN_REMOTE_INTERVAL = 400;

let originalStatus: CustomStatusValue | undefined | null = null;
let capturedOriginal = false;
let restorePending = false;
let lastLocalText = "";
let lastRemoteText: string | undefined;
let pendingText = "";
let inFlight = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let nextAt = 0;

function debug(message: string) {
    if (settings.store.debugLog) logger.info(message);
}

function statusSetting() {
    return CustomStatus;
}

export async function captureOriginalStatus() {
    if (capturedOriginal) return;

    try {
        const current = statusSetting()?.getSetting();
        const lastWritten = await DataStore.get<string>(LAST_KEY);
        const stored = await DataStore.get<CustomStatusValue | null>(ORIGINAL_KEY);
        const currentText = cleanText(current?.text);

        if (currentText && currentText !== cleanText(lastWritten)) {
            originalStatus = current;
            await DataStore.set(ORIGINAL_KEY, current ?? null);
        } else {
            originalStatus = stored ?? current ?? null;
        }

        capturedOriginal = true;
        debug(`captured original status "${cleanText(originalStatus?.text)}"`);
    } catch (error) {
        logger.warn("Could not read current custom status", error);
        capturedOriginal = true;
    }
}

export function hasCapturedOriginal() {
    return capturedOriginal;
}

export function forgetOriginalStatus() {
    originalStatus = null;
    capturedOriginal = false;
}

function currentRemoteText() {
    try {
        return cleanText(statusSetting()?.getSetting()?.text);
    } catch {
        return "";
    }
}

function localPreview(text: string) {
    FluxDispatcher.dispatch({
        type: "LOCAL_ACTIVITY_UPDATE",
        activity: text ? {
            id: "custom",
            name: "Custom Status",
            state: text,
            type: ActivityType.CUSTOM_STATUS,
            flags: ActivityFlags.INSTANCE,
            created_at: Date.now()
        } satisfies Activity : null,
        socketId: STATUS_SOCKET
    });
}

function emojiFields(text: string): CustomStatusValue {
    const emojiName = cleanText(settings.store.statusEmoji);
    return {
        text,
        emojiName: emojiName || originalStatus?.emojiName || "",
        emojiId: originalStatus?.emojiId || "0",
        expiresAtMs: "0",
        createdAtMs: String(Date.now())
    };
}

async function flush() {
    if (inFlight) return;
    if (timer) {
        clearTimeout(timer);
        timer = undefined;
    }

    const text = pendingText;
    if (text === lastRemoteText) return;

    inFlight = true;
    try {
        const setting = statusSetting();
        if (!setting) throw new Error("status.customStatus is unavailable. Enable UserSettingsAPI.");

        if (restorePending && settings.store.restoreOnStop)
            await setting.updateSetting(originalStatus ?? undefined);
        else if (text)
            await setting.updateSetting(emojiFields(text));
        else
            await setting.updateSetting(undefined);

        lastRemoteText = text;
        nextAt = Date.now() + MIN_REMOTE_INTERVAL;
        void DataStore.set(LAST_KEY, restorePending ? cleanText(originalStatus?.text) : text);
        restorePending = false;
        debug(`custom status ok "${text}"`);
    } catch (error) {
        const retry = Number((error as { retryAfter?: number; body?: { retry_after?: number; }; })?.retryAfter
            ?? (error as { body?: { retry_after?: number; }; })?.body?.retry_after);
        nextAt = Date.now() + (Number.isFinite(retry) && retry > 0 ? retry * 1000 : 1500);
        logger.warn("Discord rejected a custom status update", error);
    } finally {
        inFlight = false;
        if (pendingText !== lastRemoteText) schedule();
    }
}

function schedule(urgent = false) {
    if (inFlight) return;
    if (urgent && timer) {
        clearTimeout(timer);
        timer = undefined;
        nextAt = 0;
    }
    if (timer) return;

    const delay = Math.max(0, nextAt - Date.now());
    if (urgent && delay === 0) {
        void flush();
        return;
    }

    timer = setTimeout(() => void flush(), delay);
}

export function setStatusText(text: string, urgent = false) {
    restorePending = false;
    const next = cleanText(text);
    lastLocalText = next;
    pendingText = next;
    localPreview(next);
    if (next === lastRemoteText && currentRemoteText() === next) return;
    schedule(urgent || next !== lastRemoteText);
}

export function restoreStatus(urgent = false) {
    restorePending = true;
    const text = settings.store.restoreOnStop ? cleanText(originalStatus?.text) : "";
    lastLocalText = text;
    pendingText = text;
    localPreview(text);
    if (text === lastRemoteText && currentRemoteText() === text) return;
    schedule(urgent);
}

export function lastDisplayedStatus() {
    return lastLocalText;
}

export async function shutdownStatus() {
    restorePending = true;
    pendingText = settings.store.restoreOnStop ? cleanText(originalStatus?.text) : "";
    lastLocalText = pendingText;
    lastRemoteText = undefined;

    for (let i = 0; i < 20 && inFlight; i++)
        await new Promise(resolve => setTimeout(resolve, 50));

    await flush();
}

export function resetStatusRuntime() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    inFlight = false;
    restorePending = false;
    lastLocalText = "";
    lastRemoteText = undefined;
    pendingText = "";
    nextAt = 0;
}
