/**
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ilyau and contributors
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { VoiceState } from "@vencord/discord-types";
import { MediaEngineStore, SelectedChannelStore, UserStore, VoiceStateStore } from "@webpack/common";

import { settings } from "./settings";
import { handlerFound, overrideDisabledDueToMissingHandler } from "./utils";

export interface FakeDeafenState {
    enabled: boolean;
    selfDeaf: boolean;
    audioPlaybackOverride: boolean;
}

export function getOwnVoiceState(): VoiceState | undefined {
    const userId = UserStore.getCurrentUser()?.id;
    if (!userId) return undefined;

    const byUser = VoiceStateStore.getVoiceStateForUser?.(userId);
    if (byUser) return byUser;

    const channelId = SelectedChannelStore.getVoiceChannelId?.();
    if (!channelId) return undefined;

    return (
        VoiceStateStore.getVoiceStateForChannel?.(channelId, userId) ??
        VoiceStateStore.getVoiceStatesForChannel?.(channelId)?.[userId]
    );
}

export function isServerDeaf(): boolean {
    return Boolean(getOwnVoiceState()?.deaf);
}

export function isSelfDeaf(): boolean {
    const voiceState = getOwnVoiceState();
    if (voiceState?.selfDeaf != null) return Boolean(voiceState.selfDeaf);

    try {
        return Boolean(MediaEngineStore.isSelfDeaf?.());
    } catch {
        return false;
    }
}

export function computeFakeDeafenState(): FakeDeafenState {
    const enabled = Boolean(settings.store.enabled);
    const selfDeaf = isSelfDeaf();
    const audioPlaybackOverride =
        enabled &&
        Boolean(settings.store.keepHearing) &&
        selfDeaf &&
        !isServerDeaf() &&
        handlerFound &&
        !overrideDisabledDueToMissingHandler;

    return { enabled, selfDeaf, audioPlaybackOverride };
}

export function desiredLocalDeaf(): boolean {
    if (isServerDeaf()) return true;
    const state = computeFakeDeafenState();
    if (state.audioPlaybackOverride) return false;
    return state.selfDeaf;
}
