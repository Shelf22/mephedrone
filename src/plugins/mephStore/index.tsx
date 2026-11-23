/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import SettingsPlugin from "@plugins/_core/settings";
import { BRAND } from "@shared/brand";
import { Devs } from "@utils/constants";
import { removeFromArray } from "@utils/misc";
import definePlugin from "@utils/types";

import { install, loadState, sha256, startAllEnabled, uninstall } from "./catalog";
import { onIncomingMessage, running, stopStorePlugin, transformOutgoing } from "./runtime";
import managedStyle from "./store.css?managed";
import { StoreIcon, StorePage } from "./StorePage";

export default definePlugin({
    name: "MephStore",
    description: `${BRAND} plugin store: install community plugins that run sandboxed, with only the permissions you approve`,
    authors: [Devs.MephedroneTeam],
    required: true,
    managedStyle,
    dependencies: ["CommandsAPI", "MessageEventsAPI"],

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: any; optimistic: boolean; }) {
            if (!optimistic && message) onIncomingMessage(message);
        },
    },

    async onBeforeMessageSend(channelId, msg) {
        if (msg.content?.trim()) msg.content = await transformOutgoing(channelId, msg.content);
    },

    // dev builds only: lets the test rig install throwaway plugins (used for the sandbox escape tests)
    _dev: IS_DEV ? { install, uninstall, sha256 } : undefined,

    async start() {
        SettingsPlugin.customEntries.push({ key: "meph_store", title: "Store", panelTitle: `${BRAND} Store`, Component: StorePage, Icon: StoreIcon });
        await loadState();
        startAllEnabled();
    },

    stop() {
        for (const id of [...running.keys()]) stopStorePlugin(id);
        removeFromArray(SettingsPlugin.customEntries, e => e.key === "meph_store");
    },
});
