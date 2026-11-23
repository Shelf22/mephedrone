/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";

import { HistoryEntry, ListEntry } from "./types";

const LIST_KEY = "NotifManager_list";
const HISTORY_KEY = "NotifManager_history";

type Rerender = () => void;

export const NotifManagerStore = {
    list: [] as ListEntry[],
    history: [] as HistoryEntry[],
    recentlyLogged: new Set<string>()
};

export async function loadStore(): Promise<void> {
    const [list, history] = await Promise.all([
        DataStore.get<ListEntry[]>(LIST_KEY),
        DataStore.get<HistoryEntry[]>(HISTORY_KEY)
    ]);
    NotifManagerStore.list = Array.isArray(list) ? list : [];
    NotifManagerStore.history = Array.isArray(history) ? history : [];
}

export function addToList(entry: ListEntry, rerender?: Rerender, fromQuickAction?: boolean): void {
    if (NotifManagerStore.list.some(e => e.id === entry.id)) return;
    const stored: ListEntry = fromQuickAction !== undefined ? { ...entry, fromQuickAction } : entry;
    NotifManagerStore.list = [...NotifManagerStore.list, stored];
    void DataStore.set(LIST_KEY, NotifManagerStore.list);
    rerender?.();
}

export function clearList(rerender?: Rerender): void {
    NotifManagerStore.list = [];
    void DataStore.set(LIST_KEY, []);
    rerender?.();
}

export function removeFromList(id: string, rerender?: Rerender): void {
    NotifManagerStore.list = NotifManagerStore.list.filter(e => e.id !== id);
    void DataStore.set(LIST_KEY, NotifManagerStore.list);
    rerender?.();
}

export function addException(serverId: string, channelId: string, channelLabel: string): void {
    NotifManagerStore.list = [...NotifManagerStore.list, {
        type: "channel-exception",
        id: channelId,
        label: channelLabel,
        parentServerId: serverId
    }];
    void DataStore.set(LIST_KEY, NotifManagerStore.list);
}

const HISTORY_MAX = 100;

export function addToHistory(entry: HistoryEntry, rerender?: Rerender): void {
    const next = [...NotifManagerStore.history];
    while (next.length >= HISTORY_MAX) next.shift();
    next.push(entry);
    NotifManagerStore.history = next;
    void DataStore.set(HISTORY_KEY, NotifManagerStore.history);
    rerender?.();
}

export function clearHistory(rerender?: Rerender): void {
    NotifManagerStore.history = [];
    void DataStore.set(HISTORY_KEY, []);
    rerender?.();
}
