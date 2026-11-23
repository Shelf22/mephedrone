/**
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ilyau and contributors
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { showToast, Toasts } from "@webpack/common";

import { settings } from "./settings";

export const logger = new Logger("FakeDeafen");

export let handlerFound = false;
export let overrideDisabledDueToMissingHandler = false;

let lastOverrideActive = false;

export function markHandlerFound() {
    handlerFound = true;
}

export function disableAudioOverride(reason?: string) {
    handlerFound = false;
    overrideDisabledDueToMissingHandler = true;
    logger.error("Unable to locate Discord audio playback handler.\nFake Deafen audio override disabled.");
    if (reason) logger.error(reason);
}

export function resetOverrideGuard() {
    handlerFound = false;
    overrideDisabledDueToMissingHandler = false;
    lastOverrideActive = false;
}

export function notifyOverrideIfNeeded(active: boolean) {
    if (active && !lastOverrideActive && settings.store.showNotification) {
        showToast("Fake Deafen: hearing override is active", Toasts.Type.MESSAGE);
    }
    lastOverrideActive = active;
}
