/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { findGroupChildrenByChildId } from "@api/ContextMenu";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { findStoreLazy } from "@webpack";
import { ChannelStore, GuildStore, Menu, UserStore } from "@webpack/common";

import settings from "./settings";
import { addToHistory, addToList, loadStore, NotifManagerStore, removeFromList } from "./store";
import { KeywordMode, NotifMode } from "./types";
import { matchesKeyword, shouldSuppress } from "./utils";

const logger = new Logger("NotifManager");

const SortedGuildStore = findStoreLazy("SortedGuildStore");

function getFolderGuildIds(props: any): string[] | null {
    const folderId = props?.folderId ?? props?.folder?.folderId ?? props?.folder?.id;
    if (folderId == null) return null;
    try {
        const folders = SortedGuildStore?.getGuildFolders?.() ?? [];
        const folder = folders.find((f: any) => f.folderId === folderId || f.id === folderId);
        if (folder && Array.isArray(folder.guildIds)) return folder.guildIds;
    } catch (e) {
        logger.error("getFolderGuildIds threw", e);
    }
    return null;
}

export default definePlugin({
    name: "NotifManager",
    description: "⚠️ May be outdated for the current Discord. Full control over which servers, channels, DMs, and group chats can send you notifications.",
    authors: [Devs.nightwielder23],
    tags: ["Notifications", "Utility", "Privacy"],
    searchTerms: ["mute", "suppress", "notification", "quiet hours", "blacklist", "whitelist", "dnd", "do not disturb"],
    settings,

    contextMenus: {
        "guild-context": (children, props) => {
            if (props?.guild) {
                const guild = props.guild;
                const inList = NotifManagerStore.list.some(e => e.id === guild.id);
                const item = <Menu.MenuItem
                    id="notifmanager-guild"
                    label={inList ? "Remove from NotifManager" : "Add to NotifManager"}
                    action={() => inList ? removeFromList(guild.id) : addToList({ type: "server", id: guild.id, label: guild.name })}
                />;
                const group = findGroupChildrenByChildId(["unmute-guild", "mute-guild"], children);
                if (group) {
                    const muteIndex = group.findIndex((el: any) => el?.props?.id === "unmute-guild" || el?.props?.id === "mute-guild");
                    if (muteIndex !== -1) {
                        group.splice(muteIndex + 1, 0, item);
                    } else {
                        group.push(item);
                    }
                }
                return;
            }

            const folderGuildIds = getFolderGuildIds(props);
            if (!folderGuildIds || folderGuildIds.length === 0) return;

            const allInList = folderGuildIds.every(id => NotifManagerStore.list.some(e => e.id === id));
            const item = <Menu.MenuItem
                id="notifmanager-folder"
                label={allInList ? "Remove folder from NotifManager" : "Add folder to NotifManager"}
                action={() => {
                    if (allInList) {
                        for (const id of folderGuildIds) removeFromList(id);
                    } else {
                        for (const id of folderGuildIds) {
                            const g = GuildStore.getGuild(id);
                            if (g) addToList({ type: "server", id: g.id, label: g.name });
                        }
                    }
                }}
            />;
            const group = findGroupChildrenByChildId(["unmute-guild", "mute-guild"], children)
                ?? findGroupChildrenByChildId("privacy", children);
            if (group) group.push(item);
            else children.push(item);
        },

        "guild-header-popout": (children, props) => {
            if (!props?.guild) return;
            const guild = props.guild;
            const inList = NotifManagerStore.list.some(e => e.id === guild.id);
            const item = <Menu.MenuItem
                id="notifmanager-guild-popout"
                label={inList ? "Remove from NotifManager" : "Add to NotifManager"}
                action={() => inList ? removeFromList(guild.id) : addToList({ type: "server", id: guild.id, label: guild.name })}
            />;
            const group = findGroupChildrenByChildId(["unmute-guild", "mute-guild"], children);
            if (group) {
                const muteIndex = group.findIndex((el: any) => el?.props?.id === "unmute-guild" || el?.props?.id === "mute-guild");
                if (muteIndex !== -1) {
                    group.splice(muteIndex + 1, 0, item);
                } else {
                    group.push(item);
                }
            }
        },

        "channel-context": (children, props) => {
            if (!props?.channel) return;
            const channel = props.channel;
            const type = channel.type === 1 ? "dm" : channel.type === 3 ? "gc" : "channel";
            const label = channel.name || channel.rawRecipients?.[0]?.username || channel.id;
            const inList = NotifManagerStore.list.some(e => e.id === channel.id);
            const item = <Menu.MenuItem
                id="notifmanager-channel"
                label={inList ? "Remove from NotifManager" : "Add to NotifManager"}
                action={() => inList ? removeFromList(channel.id) : addToList({ type, id: channel.id, label })}
            />;
            const group = findGroupChildrenByChildId(["mute-channel", "unmute-channel"], children);
            if (group) group.push(item);
        },

        "thread-context": (children, props) => {
            if (!props?.channel) return;
            const channel = props.channel;
            const label = channel.name || channel.id;
            const inList = NotifManagerStore.list.some(e => e.id === channel.id);
            const item = <Menu.MenuItem
                id="notifmanager-thread"
                label={inList ? "Remove from NotifManager" : "Add to NotifManager"}
                action={() => inList ? removeFromList(channel.id) : addToList({ type: "channel", id: channel.id, label })}
            />;
            const group = findGroupChildrenByChildId(["mute-channel", "unmute-channel"], children);
            if (group) group.push(item);
        },

        "user-context": (children, props) => {
            if (!props?.user) return;
            const user = props.user;
            const channelId = ChannelStore.getDMFromUserId(user.id);
            if (!channelId) return;
            const label = user.globalName ?? user.username ?? user.id;
            const inList = NotifManagerStore.list.some(e => e.id === channelId);
            const item = <Menu.MenuItem
                id="notifmanager-user"
                label={inList ? "Remove from NotifManager" : "Add to NotifManager"}
                action={() => inList ? removeFromList(channelId) : addToList({ type: "dm", id: channelId, label })}
            />;
            const group = findGroupChildrenByChildId("roles", children);
            if (group) group.push(item);
            else children.splice(-1, 0, <Menu.MenuGroup>{item}</Menu.MenuGroup>);
        },

        "gdm-context": (children, props) => {
            if (!props?.channel) return;
            const channel = props.channel;
            const label = channel.name || channel.rawRecipients?.map((r: any) => r.username).join(", ") || channel.id;
            const inList = NotifManagerStore.list.some(e => e.id === channel.id);
            const item = <Menu.MenuItem
                id="notifmanager-gdm"
                label={inList ? "Remove from NotifManager" : "Add to NotifManager"}
                action={() => inList ? removeFromList(channel.id) : addToList({ type: "gc", id: channel.id, label })}
            />;
            const group = findGroupChildrenByChildId("unmute-channel", children);
            if (group) group.push(item);
            else children.push(item);
        }
    },

    patches: [
        {
            find: ".SUPPRESS_NOTIFICATIONS))return!1",
            replacement: {
                match: /function (\i)\((\i),(\i)\)\{/,
                replace: "function $1($2,$3){if($self.shouldSuppressPopup($2,$3))return false;"
            }
        },
        {
            find: '"ReadStateStore"',
            replacement: {
                match: /(?<=function (\i)\((\i)\){)(?=.*MESSAGE_CREATE:\1)/,
                replace: (_, _funcName, props) => `if($self.shouldHideReadState(${props}.message))return;`
            }
        },
        {
            find: "ensureAudio(){",
            replacement: {
                match: /(?=Math\.min\(\i\.\i\.getOutputVolume\(\)\/100)/g,
                replace: "$self.settings.store.muteAllSounds?0:1*"
            }
        }
    ],

    shouldHideReadState(message: any): boolean {
        try {
            const store = settings.store;
            const vipList = store.vipUsers.split(",").map((v: string) => v.trim()).filter((v: string) => v.length > 0);
            const authorId = message?.author?.id ?? "";
            if (vipList.length > 0 && vipList.includes(authorId)) return false;

            const currentUser = UserStore.getCurrentUser();
            if (message?.author?.id === currentUser?.id) return false;

            const channelId = message?.channel_id;
            if (!channelId) return false;

            const suppressed = this.checkSuppress(message, channelId);
            if (!suppressed) return false;

            const messageId = message?.id;
            if (messageId && NotifManagerStore.recentlyLogged.has(messageId)) return true;

            const channel = ChannelStore.getChannel(channelId);
            const guildId = channel?.guild_id ?? "";
            const guild = guildId ? GuildStore.getGuild(guildId) : null;
            const channelType = channel?.type;
            const isDM = channelType === 1 || channelType === 3;

            const mentions = Array.isArray(message?.mentions) ? message.mentions : [];
            const mentionsCurrentUser = mentions.some((m: any) => (typeof m === "string" ? m : m?.id) === currentUser?.id);
            const isUserRelevant = message?.mention_everyone === true || mentionsCurrentUser || isDM;

            if (!isUserRelevant) return true;

            let sourceLabel = channelId;
            if (guild?.name && channel?.name) {
                sourceLabel = `${guild.name} #${channel.name}`;
            } else if (channel?.name) {
                sourceLabel = channel.name;
            } else if (channel?.rawRecipients?.[0]?.username) {
                sourceLabel = channel.rawRecipients[0].username;
            }

            const authorUser = authorId ? (UserStore.getUser(authorId) as any) : null;
            const senderName = authorUser?.globalName ?? authorUser?.username ?? message?.author?.username ?? "Unknown";

            if (messageId) {
                NotifManagerStore.recentlyLogged.add(messageId);
                setTimeout(() => NotifManagerStore.recentlyLogged.delete(messageId), 5000);
            }

            addToHistory({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                sourceId: channelId,
                sourceLabel,
                senderName,
                content: message?.content ?? "",
                timestamp: Date.now()
            });

            return true;
        } catch (e) {
            logger.error("shouldHideReadState threw", e);
            return false;
        }
    },

    shouldSuppressPopup(message: any, channelId: string): boolean {
        if (settings.store.muteAllPopups) return true;
        return this.checkSuppress(message, channelId);
    },

    checkSuppress(message: any, channelId: string): boolean {
        try {
            const channel = ChannelStore.getChannel(channelId);
            const guildId = channel?.guild_id ?? "";

            const channelType = channel?.type;
            const isDM = channelType === 1 || channelType === 3;
            const sourceId = channelId;

            const mentions = Array.isArray(message?.mentions) ? message.mentions : [];
            const isMention = mentions.length > 0 || message?.mention_everyone === true;

            const store = settings.store;

            const vipList = store.vipUsers.split(",").map((v: string) => v.trim()).filter((v: string) => v.length > 0);
            const authorId = message?.author?.id ?? "";
            if (vipList.length > 0 && vipList.includes(authorId)) return false;

            if (store.keywords.trim().length > 0 && store.keywordMode === "allow") {
                if (matchesKeyword(message?.content ?? "", store.keywords)) return false;
            }

            if (store.muteAllDMs && channelType === 1) return true;
            if (store.muteAllGCs && channelType === 3) return true;
            if (store.muteAllServers && guildId && channelType !== 1 && channelType !== 3) return true;

            return shouldSuppress({
                sourceId,
                guildId,
                authorId,
                content: message?.content ?? "",
                isMention,
                isDM,
                mode: store.mode as NotifMode,
                list: NotifManagerStore.list,
                quietHoursEnabled: store.quietHoursEnabled,
                quietHoursStart: store.quietHoursStart,
                quietHoursEnd: store.quietHoursEnd,
                quietHoursAllowMentions: store.quietHoursAllowMentions,
                quietHoursAllowDMs: store.quietHoursAllowDirectMessages,
                quietHoursExceptions: store.quietHoursExceptions,
                vipUsers: store.vipUsers,
                keywords: store.keywords,
                keywordMode: store.keywordMode as KeywordMode
            });
        } catch (e) {
            logger.error("checkSuppress threw", e);
            return false;
        }
    },

    start() {
        loadStore().catch(e => logger.error("Failed to load store", e));
    },

    stop() {
    }
});
