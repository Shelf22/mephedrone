/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Jumble
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { updateMessage } from "@api/MessageUpdater";
import definePlugin from "@utils/types";
import { Message, RenderModalProps } from "@vencord/discord-types";
import { FluxDispatcher, Menu, Modal, openModal, TextInput, useState } from "@webpack/common";

const author = { name: "Jumble", id: 1135976262234542233n };

function EditMessageModal({ modalProps, message }: { modalProps: RenderModalProps; message: Message; }) {
    const [content, setContent] = useState(message.content);

    return (
        <Modal
            {...modalProps}
            title="Edit Message"
            subtitle="This only changes the message shown in your client."
            actions={[
                {
                    text: "Cancel",
                    variant: "secondary",
                    onClick: modalProps.onClose
                },
                {
                    text: "Save",
                    variant: "primary",
                    onClick: () => {
                        if (content !== message.content) {
                            updateMessage(message.channel_id, message.id, { content });
                        }
                        modalProps.onClose();
                    }
                }
            ]}
        >
            <TextInput value={content} onChange={setContent} />
        </Modal>
    );
}

function openEditMessageModal(message: Message) {
    openModal(modalProps => (
        <EditMessageModal modalProps={modalProps} message={message} />
    ));
}

const patchMessageContextMenu: NavContextMenuPatchCallback = (children, { message }) => {
    if (!message) return;

    children.push(
        <Menu.MenuItem
            id="local-message-actions-edit-cached"
            key="local-message-actions-edit-cached"
            label="Edit Message"
            action={() => openEditMessageModal(message)}
        />,
        <Menu.MenuItem
            id="local-message-actions-remove"
            key="local-message-actions-remove"
            label="Remove Message"
            action={() => {
                FluxDispatcher.dispatch({
                    type: "MESSAGE_DELETE",
                    channelId: message.channel_id,
                    id: message.id,
                    mlDeleted: true
                });
            }}
        />
    );
};

export default definePlugin({
    name: "MessageEdit",
    description: "Adds local message edit and removal actions to message context menus.",
    authors: [author],
    dependencies: ["MessageUpdaterAPI"],
    contextMenus: {
        message: patchMessageContextMenu
    }
});
