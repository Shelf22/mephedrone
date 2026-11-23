/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type ListEntryType = "server" | "channel" | "dm" | "gc" | "channel-exception";

export interface ListEntry {
    type: ListEntryType;
    id: string;
    label: string;
    parentServerId?: string;
    fromQuickAction?: boolean;
}

export interface HistoryEntry {
    id: string;
    sourceId: string;
    sourceLabel: string;
    senderName: string;
    content: string;
    timestamp: number;
}

export type KeywordMode = "suppress" | "allow";

export type NotifMode = "whitelist" | "blacklist";
