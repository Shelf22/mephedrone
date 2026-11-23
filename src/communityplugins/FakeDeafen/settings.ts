/**
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ilyau and contributors
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable Fake Deafen override while this plugin is on",
        default: true,
        onChange() {
            void import("./audio").then(m => m.applyLocalAudioOverride("settings.enabled"));
        }
    },
    keepHearing: {
        type: OptionType.BOOLEAN,
        description: "Keep hearing incoming voice audio while self-deafened",
        default: true,
        onChange() {
            void import("./audio").then(m => m.applyLocalAudioOverride("settings.keepHearing"));
        }
    },
    showNotification: {
        type: OptionType.BOOLEAN,
        description: "Show a toast when the local hearing override turns on",
        default: false
    }
});
