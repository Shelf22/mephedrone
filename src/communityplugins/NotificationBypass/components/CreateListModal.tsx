/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Text } from "@components/Text";
import { ModalContent, ModalHeader, ModalRoot, openModalLazy } from "@utils/modal";
import { extractAndLoadChunksLazy } from "@webpack";
import { showToast } from "@webpack/common";
import { alterActivateUser, bypassLen, getAllUsers, removeUser, changeCustomName } from "../data";
import { t } from "../i18n";
import { classNameFactory } from "@api/Styles";
import { useForceUpdater } from "@utils/react";
import { useState } from "@webpack/common";
export const requireSettingsMenu = extractAndLoadChunksLazy(
    ['name:"UserSettings"'],
    /createPromise:.{0,20}(\i\.\i\("?.+?"?\).*?).then\(\i\.bind\(\i,"?(.+?)"?\)\).{0,50}"UserSettings"/,
);

const cl = classNameFactory("vc-notifications-");

function UserItem({
    user,
    onRemove,
    onAlterActivate,
    onCustomName,
}: {
    user: { id: string; name: string; customName: string; channel: string; activated: boolean };
    onRemove: (channelId: string, displayName: string) => void;
    onAlterActivate: (userId: string, displayName: string, currentlyActivated: boolean) => void;
    onCustomName: (userId: string, newCustomName: string, originalName: string) => void;
}) {
    const [customName, setCustomName] = useState(user.customName);

    return (
        <div className={cl("user-item")}>
            <div className={cl("user-info")}>
                <input
                    type="text"
                    className={cl("custom-name-input")}
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder={user.name}
                />
                <Text size="md" weight="semibold" className={cl("user-name")}>
                    {user.name}
                </Text>
            </div>
            <div className={cl("user-status", user.activated ? "activated" : "deactivated")}>
                {user.activated ? t("status.activated") : t("status.deactivated")}
            </div>
            <div className={cl("user-buttons")}>
                <Button className={cl("btn-delete")} onClick={() => onRemove(user.channel, user.customName || user.name)}>
                    {t("button.remove")}
                </Button>
                <Button
                    className={cl("btn-toggle")}
                    onClick={() => onAlterActivate(user.id, user.customName || user.name, user.activated)}
                >
                    {user.activated ? t("button.deactivate") : t("button.activate")}
                </Button>
                <Button className={cl("btn-rename")} onClick={() => onCustomName(user.id, customName, user.name)}>
                    {t("button.rename")}
                </Button>
            </div>
        </div>
    );
}

export function ModalList(modalProps: any) {
    const users = getAllUsers();
    const empty = bypassLen();
    const forceUpdater = useForceUpdater();

    const onRemove = (channelId: string, displayName: string) => {
        removeUser(channelId);
        showToast({ text: t("toast.removed", { name: displayName }), variant: "success" });
        forceUpdater();
    };

    const onAlterActivate = (userId: string, displayName: string, currentlyActivated: boolean) => {
        alterActivateUser(userId);
        showToast({
            text: currentlyActivated
                ? t("toast.deactivated", { name: displayName })
                : t("toast.activated", { name: displayName }),
            variant: "success",
        });
        forceUpdater();
    };

    const onCustomName = (userId: string, newCustomName: string, originalName: string) => {
        changeCustomName(userId, newCustomName);
        const displayName = newCustomName || originalName;
        showToast({ text: t("toast.renamed", { name: displayName }), variant: "success" });
        forceUpdater();
    };

    return (
        <ModalRoot {...modalProps} className={cl("content")}>
            <ModalHeader>
                <Heading tag="h3">{t("modal.title")}</Heading>
            </ModalHeader>

            <ModalContent>
                {empty === 0 ? (
                    <section className={cl("empty-message")}>
                        <Text>{t("modal.empty")}</Text>
                    </section>
                ) : (
                    <section className={cl("users-list")}>
                        {users.map((user) => (
                            <UserItem
                                key={user.id}
                                user={user}
                                onRemove={onRemove}
                                onAlterActivate={onAlterActivate}
                                onCustomName={onCustomName}
                            />
                        ))}
                    </section>
                )}
            </ModalContent>
        </ModalRoot>
    );
}

export const openBypassModal = () => {
    openModalLazy(async () => {
        await requireSettingsMenu();
        return (modalProps) => <ModalList {...modalProps}></ModalList>;
    });
};
