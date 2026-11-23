/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Gaiiiaaa
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { DeleteIcon } from "@components/Icons";
import definePlugin from "@utils/types";
import { ChannelStore, Menu } from "@webpack/common";

import { destroyFloatingWidget, initFloatingWidget } from "./FloatingWidget";
import { purgeManager } from "./manager";
import { openPurgeModal } from "./PurgeModal";

const patchChannelContextMenu: NavContextMenuPatchCallback = (children, props) => {
    const channel = props.channel ?? (props.user ? ChannelStore.getDMFromUserId(props.user.id) : null);
    if (!channel) return;

    const group = findGroupChildrenByChildId("mark-channel-read", children)
        ?? findGroupChildrenByChildId("channel-notifications", children)
        ?? findGroupChildrenByChildId("mute-channel", children)
        ?? children;

    group.push(
        <Menu.MenuItem
            id="vc-purge-my-messages"
            label="Supprimer mes messages..."
            color="danger"
            icon={DeleteIcon}
            leadingAccessory={{ type: "icon", icon: DeleteIcon }}
            action={() => openPurgeModal(channel)}
        />
    );
};

export default definePlugin({
    name: "PurgeMyMessages",
    description: "Permet de supprimer automatiquement vos propres messages dans un salon spécifique avec contrôle strict des rate-limits et suivi en tâche de fond.",
    authors: [{ name: "Gaiiiaaa", id: 0n }],

    start() {
        initFloatingWidget();
    },

    stop() {
        // Sans ça, le moteur continue de supprimer alors que plus aucune UI
        // ne permet de l'arrêter.
        purgeManager.stop();
        destroyFloatingWidget();
    },

    contextMenus: {
        "channel-context": patchChannelContextMenu,
        "thread-context": patchChannelContextMenu,
        "user-context": patchChannelContextMenu,
        "gdm-context": patchChannelContextMenu
    }
});
