/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { BRAND } from "@shared/brand";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType, StartAt } from "@utils/types";

import { current, guardTimezoneSetting, pickPlace, startLocationSpoof, stopLocationSpoof, unguardTimezoneSetting } from "./location";

export const settings = definePluginSettings({
    mode: { type: OptionType.CUSTOM, description: "", default: "random" as "random" | "fixed" | "off" },
    fixedCity: { type: OptionType.CUSTOM, description: "", default: "London" },
});

export { current };

export default definePlugin({
    name: "MephLocation",
    description: `${BRAND}: report a fake timezone/locale/location to Discord, re-rolled every startup`,
    authors: [Devs.MephedroneTeam],
    required: true,
    settings,
    // header + gateway login rewriting must be in place before Discord's first requests
    startAt: StartAt.Init,

    flux: {
        POST_CONNECTION_OPEN() { if (settings.store.mode !== "off") guardTimezoneSetting(); },
        USER_SETTINGS_PROTO_UPDATE() { if (settings.store.mode !== "off") guardTimezoneSetting(); },
    },

    start() {
        if (settings.store.mode === "off") return;
        pickPlace(settings.store.mode === "fixed" ? settings.store.fixedCity : undefined);
        startLocationSpoof();
    },

    stop() {
        stopLocationSpoof();
        unguardTimezoneSetting();
    },
});
