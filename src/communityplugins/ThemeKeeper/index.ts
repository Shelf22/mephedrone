/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 yarik and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, proxyLazyWebpack } from "@webpack";
import { FluxDispatcher, UserSettingsActionCreators, UserSettingsProtoStore, UserStore } from "@webpack/common";

const DATA_KEY = "ThemeKeeper_snapshots";
const WATCHDOG_INTERVAL = 10_000;
const logger = new Logger("ThemeKeeper");

interface ThemeSnapshot {
    version: 1;
    bytes: number[];
    updatedAt: number;
}

interface PersistedData {
    version: 1;
    accounts: Record<string, ThemeSnapshot>;
}

interface UserSettingsProtoUpdateEvent {
    local?: boolean;
    settings?: {
        proto?: {
            appearance?: unknown;
        };
    };
}

const settings = definePluginSettings({
    autoRestore: {
        description: "Restore the saved Discord appearance after it is unexpectedly reset",
        type: OptionType.BOOLEAN,
        default: true
    },
    watchdog: {
        description: "Periodically check that Discord has not silently reset the saved appearance",
        type: OptionType.BOOLEAN,
        default: true
    },
    restoreDelay: {
        description: "Delay before restoring the appearance after Discord reconnects (milliseconds)",
        type: OptionType.SLIDER,
        markers: [250, 500, 1000, 1500, 2500, 5000],
        default: 1500
    },
    notifyOnRestore: {
        description: "Show a notification when ThemeKeeper restores the appearance",
        type: OptionType.BOOLEAN,
        default: true
    }
});

const BINARY_READ_OPTIONS = findByPropsLazy("readerFactory");

function searchProtoClassField(localName: string, protoClass: any) {
    const field = protoClass?.fields?.find((candidate: any) => candidate.localName === localName);
    if (!field) return;

    const fieldGetter = Object.values(field).find(value => typeof value === "function") as (() => any) | undefined;
    return fieldGetter?.();
}

const PreloadedUserSettingsActionCreators = proxyLazyWebpack(
    () => UserSettingsActionCreators.PreloadedUserSettingsActionCreators
);
const AppearanceSettingsActionCreators = proxyLazyWebpack(
    () => searchProtoClassField("appearance", PreloadedUserSettingsActionCreators.ProtoClass)
);

let data: PersistedData = {
    version: 1,
    accounts: {}
};
let restoreTimer: ReturnType<typeof setTimeout> | undefined;
let captureTimer: ReturnType<typeof setTimeout> | undefined;
let watchdogTimer: ReturnType<typeof setInterval> | undefined;
let isRestoring = false;
let suppressCaptureUntil = 0;

function getAccountId() {
    return UserStore.getCurrentUser()?.id as string | undefined;
}

function getCurrentAppearance() {
    return PreloadedUserSettingsActionCreators.getCurrentValue()?.appearance
        ?? UserSettingsProtoStore.settings?.appearance;
}

function getThemeBytes(appearance: any): number[] | undefined {
    if (!appearance || !AppearanceSettingsActionCreators) return;

    const themeOnlyAppearance = AppearanceSettingsActionCreators.create({
        theme: appearance.theme,
        clientThemeSettings: appearance.clientThemeSettings
    });

    return Array.from(AppearanceSettingsActionCreators.toBinary(themeOnlyAppearance));
}

function bytesEqual(left: number[] | undefined, right: number[] | undefined) {
    if (!left || !right || left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
}

async function captureCurrentTheme(reason: string) {
    if (isRestoring || Date.now() < suppressCaptureUntil) return;

    try {
        const accountId = getAccountId();
        const bytes = getThemeBytes(getCurrentAppearance());
        if (!accountId || !bytes) return;

        const previous = data.accounts[accountId];
        if (bytesEqual(previous?.bytes, bytes)) return;

        data.accounts[accountId] = {
            version: 1,
            bytes,
            updatedAt: Date.now()
        };

        await DataStore.set(DATA_KEY, data);
        logger.info(`Saved appearance (${reason})`);
    } catch (error) {
        logger.error("Failed to save the current appearance", error);
    }
}

async function restoreSavedTheme(reason: string) {
    if (!settings.store.autoRestore || isRestoring) return;

    try {
        const accountId = getAccountId();
        if (!accountId) return;

        const snapshot = data.accounts[accountId];
        if (!snapshot) {
            scheduleCapture("initial appearance", 1000);
            return;
        }

        const currentAppearance = getCurrentAppearance();
        const currentBytes = getThemeBytes(currentAppearance);
        if (bytesEqual(currentBytes, snapshot.bytes)) return;

        if (
            !PreloadedUserSettingsActionCreators
            || !AppearanceSettingsActionCreators
            || !BINARY_READ_OPTIONS
        ) {
            logger.warn("Discord appearance protobuf is not ready yet");
            return;
        }

        const savedThemeAppearance = AppearanceSettingsActionCreators.fromBinary(
            Uint8Array.from(snapshot.bytes),
            BINARY_READ_OPTIONS
        );
        const restoredAppearance = currentAppearance
            ? AppearanceSettingsActionCreators.fromBinary(
                AppearanceSettingsActionCreators.toBinary(currentAppearance),
                BINARY_READ_OPTIONS
            )
            : AppearanceSettingsActionCreators.create();

        restoredAppearance.theme = savedThemeAppearance.theme;
        restoredAppearance.clientThemeSettings = savedThemeAppearance.clientThemeSettings;

        const proto = PreloadedUserSettingsActionCreators.ProtoClass.create();
        proto.appearance = restoredAppearance;

        isRestoring = true;
        suppressCaptureUntil = Date.now() + 1500;
        FluxDispatcher.dispatch({
            type: "USER_SETTINGS_PROTO_UPDATE",
            local: true,
            partial: true,
            settings: {
                type: 1,
                proto
            }
        });
        logger.info(`Restored appearance (${reason})`);

        if (settings.store.notifyOnRestore) {
            showNotification({
                title: "ThemeKeeper",
                body: "Discord reset your appearance, so ThemeKeeper restored it.",
                noPersist: true
            });
        }
    } catch (error) {
        logger.error("Failed to restore the saved appearance", error);
    } finally {
        isRestoring = false;
    }
}

function scheduleCapture(reason: string, delay = 400) {
    if (captureTimer) clearTimeout(captureTimer);
    captureTimer = setTimeout(() => {
        captureTimer = undefined;
        void captureCurrentTheme(reason);
    }, delay);
}

function scheduleRestore(reason: string, delay = settings.store.restoreDelay) {
    if (restoreTimer) clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
        restoreTimer = undefined;
        void restoreSavedTheme(reason);
    }, delay);
}

export default definePlugin({
    name: "ThemeKeeper",
    description: "Remembers the appearance selected through FakeNitro and restores it if Discord resets it",
    authors: [{ name: "Dunter & Codex", id: 0n }],
    tags: ["Appearance", "Customisation"],
    dependencies: ["FakeNitro"],
    settings,

    flux: {
        CONNECTION_OPEN() {
            scheduleRestore("connection opened");
        },

        USER_SETTINGS_PROTO_UPDATE(event: UserSettingsProtoUpdateEvent) {
            if (event.settings?.proto?.appearance == null) return;
            if (isRestoring || Date.now() < suppressCaptureUntil) return;

            if (event.local) {
                scheduleCapture("local appearance update");
            } else {
                scheduleRestore("remote settings update");
            }
        }
    },

    async start() {
        const storedData = await DataStore.get<PersistedData>(DATA_KEY);
        if (storedData?.version === 1 && storedData.accounts) data = storedData;

        scheduleRestore("plugin started");
        watchdogTimer = setInterval(() => {
            if (settings.store.watchdog) void restoreSavedTheme("watchdog");
        }, WATCHDOG_INTERVAL);
    },

    stop() {
        if (restoreTimer) clearTimeout(restoreTimer);
        if (captureTimer) clearTimeout(captureTimer);
        if (watchdogTimer) clearInterval(watchdogTimer);

        restoreTimer = undefined;
        captureTimer = undefined;
        watchdogTimer = undefined;
    }
});
