/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { ChannelStore, GuildStore } from "@webpack/common";

import { KeywordMode, ListEntry, NotifMode } from "./types";

const logger = new Logger("NotifManager");

export function isInQuietHours(start: string, end: string): boolean {
    try {
        const [startH, startM] = start.split(":").map(Number);
        const [endH, endM] = end.split(":").map(Number);

        const now = new Date();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        if (startMinutes <= endMinutes) {
            return nowMinutes >= startMinutes && nowMinutes < endMinutes;
        }

        return nowMinutes >= startMinutes || nowMinutes < endMinutes;
    } catch (e) {
        logger.error("Failed to evaluate quiet hours range", e);
        return false;
    }
}

export function matchesKeyword(content: string, keywords: string): boolean {
    try {
        const list = keywords.split(",").map(k => k.trim()).filter(k => k.length > 0);
        if (list.length === 0) return false;

        const lowerContent = content.toLowerCase();
        return list.some(k => lowerContent.includes(k.toLowerCase()));
    } catch (e) {
        logger.error("Failed to match keyword list", e);
        return false;
    }
}

export function shouldSuppress(params: {
    sourceId: string;
    guildId: string;
    authorId: string;
    content: string;
    isMention: boolean;
    isDM: boolean;
    mode: NotifMode;
    list: ListEntry[];
    quietHoursEnabled: boolean;
    quietHoursStart: string;
    quietHoursEnd: string;
    quietHoursAllowMentions: boolean;
    quietHoursAllowDMs: boolean;
    quietHoursExceptions: string;
    vipUsers: string;
    keywords: string;
    keywordMode: KeywordMode;
}): boolean {
    try {
        const {
            sourceId,
            guildId,
            authorId,
            content,
            isMention,
            isDM,
            mode,
            list,
            quietHoursEnabled,
            quietHoursStart,
            quietHoursEnd,
            quietHoursAllowMentions,
            quietHoursAllowDMs,
            quietHoursExceptions,
            vipUsers,
            keywords,
            keywordMode
        } = params;

        const vipList = vipUsers.split(",").map(v => v.trim()).filter(v => v.length > 0);

        if (authorId.length > 0 && vipList.includes(authorId)) {
            return false;
        }

        if (keywords.trim().length > 0 && keywordMode === "allow" && matchesKeyword(content, keywords)) {
            return false;
        }

        const qhExceptionList = quietHoursExceptions.split(",").map(v => v.trim()).filter(v => v.length > 0);
        const hasQHException = qhExceptionList.includes(sourceId) || (guildId.length > 0 && qhExceptionList.includes(guildId));

        if (!hasQHException && quietHoursEnabled && isInQuietHours(quietHoursStart, quietHoursEnd)) {
            if (isMention && quietHoursAllowMentions) return false;
            if (isDM && quietHoursAllowDMs) return false;
            return true;
        }

        if (keywords.trim().length > 0 && keywordMode === "suppress" && matchesKeyword(content, keywords)) {
            return true;
        }

        const hasException = guildId.length > 0 && list.some(entry => entry.type === "channel-exception" && entry.id === sourceId && entry.parentServerId === guildId);
        const inList = list.some(entry => entry.type !== "channel-exception" && (entry.id === sourceId || (guildId.length > 0 && entry.id === guildId)));

        if (hasException) {
            if (mode === "blacklist") return !inList;
            return inList;
        }

        if (mode === "blacklist") return inList;
        return !inList;
    } catch (e) {
        logger.error("Failed to evaluate suppression rules", e);
        return false;
    }
}

export function getSourceLabel(sourceId: string): string {
    try {
        const guild = GuildStore.getGuild(sourceId);
        if (guild?.name) return guild.name;

        const channel = ChannelStore.getChannel(sourceId);
        if (channel?.name) return channel.name;

        return sourceId;
    } catch (e) {
        logger.error("Failed to resolve source label", e);
        return sourceId;
    }
}
