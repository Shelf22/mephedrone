/**
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ilyau and contributors
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Patch } from "@utils/types";

// Discord applies local deafen on MediaEngineConnection.setSelfDeaf from a few call sites.
// These patches keep the real Voice State (self_deaf) intact while routing the local
// playback flag through shouldLocalDeaf.
export const patches: Omit<Patch, "plugin">[] = [
    {
        find: ".setSelfDeaf(",
        replacement: {
            match: /(\i)\.setSelfDeaf\((\i\.deaf)\)/,
            replace: "$1.setSelfDeaf($self.shouldLocalDeaf($2))"
        }
    },
    {
        find: ".setSelfMute(",
        noWarn: true,
        replacement: {
            match: /(\i)\.setSelfDeaf\((\i)\)/,
            replace: "$1.setSelfDeaf($self.shouldLocalDeaf($2))"
        }
    }
];
