/**
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ilyau and contributors
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Paragraph } from "@components/Paragraph";
import { Margins } from "@utils/margins";
import definePlugin from "@utils/types";
import { Forms, UserStore } from "@webpack/common";

import { applyLocalAudioOverride, installAudioOverride, shouldLocalDeaf, uninstallAudioOverride } from "./audio";
import { patches } from "./patches";
import { settings } from "./settings";

const DISCLAIMER =
    "Fake Deafen keeps Discord Voice State self_deaf, but changes local incoming audio playback.";

function SettingsAbout() {
    return (
        <>
            <Forms.FormTitle tag="h3">How it works</Forms.FormTitle>
            <Paragraph className={Margins.bottom8}>{DISCLAIMER}</Paragraph>
            <Paragraph>
                The standard Discord Deafen button still sends the real Voice State to other clients.
                This plugin only keeps local incoming audio playing. Server mute, server deafen,
                permissions, and bans are not bypassed.
            </Paragraph>
        </>
    );
}

function applyOwnVoiceStateUpdate(voiceStates?: Array<{ userId?: string; }>) {
    const currentUserId = UserStore.getCurrentUser()?.id;
    if (!currentUserId || !voiceStates?.some(state => state?.userId === currentUserId)) return;
    applyLocalAudioOverride("VOICE_STATE_UPDATES");
}

export default definePlugin({
    name: "FakeDeafen",
    description: "Keep hearing voice chat while Discord shows you as deafened. Uses the normal Deafen button.",
    authors: [{ name: "ilyau", id: 0n }],
    tags: ["Voice", "Utility"],
    settings,
    patches,
    settingsAboutComponent: SettingsAbout,

    shouldLocalDeaf,

    flux: {
        AUDIO_TOGGLE_SELF_DEAF() {
            applyLocalAudioOverride("AUDIO_TOGGLE_SELF_DEAF");
        },
        AUDIO_SET_SELF_DEAF() {
            applyLocalAudioOverride("AUDIO_SET_SELF_DEAF");
        },
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates?: Array<{ userId?: string; }>; }) {
            applyOwnVoiceStateUpdate(voiceStates);
        },
        RTC_CONNECTION_STATE({ state }: { state?: string; }) {
            if (state !== "RTC_CONNECTED" && state !== "RTC_CONNECTING" && state !== "AUTHENTICATING") return;
            applyLocalAudioOverride(`RTC_CONNECTION_STATE ${state}`);
        },
        VOICE_CHANNEL_SELECT() {
            applyLocalAudioOverride("VOICE_CHANNEL_SELECT");
        }
    },

    start() {
        installAudioOverride();
    },

    stop() {
        uninstallAudioOverride();
    }
});
