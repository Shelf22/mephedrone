/*
 * BestMessageLogger, a Vencord plugin by Kh8da
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";

import { fetchBlob, takeCachedMedia } from "./media-cache";
import { settings } from "./settings";
import type { DeleteEntry, EditEntry, GhostPingEntry, LogEntry, LogMedia, LogMessage, Tab } from "./types";
import { discordMediaUrl, logger, userAvatarUrl } from "./utils";

/*
 * Logs live in IndexedDB (one record per entry), not in localStorage: the Discord desktop app
 * removes window.localStorage, which is why the old version lost every log on restart.
 */

let logsDb: DataStore.UseStore | null = null;
let mediaDb: DataStore.UseStore | null = null;

function getLogsDb() {
    return logsDb ??= DataStore.createStore("BestMessageLogger", "entries");
}

function getMediaDb() {
    return mediaDb ??= DataStore.createStore("BestMessageLoggerMedia", "media");
}

/** Newest first. */
export const entries: { deleted: DeleteEntry[]; edited: EditEntry[]; ghostPings: GhostPingEntry[]; } = {
    deleted: [],
    edited: [],
    ghostPings: []
};

const byKey = new Map<string, LogEntry>();
const pendingSet = new Map<string, LogEntry>();
const pendingDel = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let loadPromise: Promise<void> | null = null;
let version = 0;

const listeners = new Set<() => void>();

export function onLogsChanged(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Bumps on every change; the log menu uses it to skip needless redraws. */
export function getVersion() {
    return version;
}

function emit() {
    version++;
    for (const listener of listeners) {
        try {
            listener();
        } catch (e) {
            logger.error("Listener failed", e);
        }
    }
}

export function entryTime(entry: LogEntry): string {
    return entry.tab === "deleted" ? entry.deletedAt : entry.tab === "edited" ? entry.editedAt : entry.detectedAt;
}

export function entryMessage(entry: LogEntry): LogMessage {
    return entry.tab === "edited" ? entry.after : entry.message;
}

export function entryMessageId(entry: LogEntry): string {
    return entry.tab === "edited" ? entry.messageId : entry.message.id;
}

export function getEntry(key: string) {
    return byKey.get(key);
}

function listFor(tab: Tab): LogEntry[] {
    return entries[tab];
}

function markDirty(entry: LogEntry) {
    pendingDel.delete(entry.key);
    pendingSet.set(entry.key, entry);
    scheduleFlush();
}

function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => void flush(), 500);
}

export async function flush() {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    if (!pendingSet.size && !pendingDel.size) return;

    const sets = [...pendingSet.entries()] as [string, LogEntry][];
    const dels = [...pendingDel];
    pendingSet.clear();
    pendingDel.clear();

    try {
        if (sets.length) await DataStore.setMany(sets, getLogsDb());
        if (dels.length) await DataStore.delMany(dels, getLogsDb());
    } catch (e) {
        logger.error("Saving logs failed", e);
    }
}

function insertSorted(list: LogEntry[], entry: LogEntry) {
    const time = entryTime(entry);
    // New entries are almost always the newest, so this is usually index 0
    let i = 0;
    while (i < list.length && entryTime(list[i]) > time) i++;
    list.splice(i, 0, entry);
}

function add(entry: LogEntry): boolean {
    if (byKey.has(entry.key)) return false;
    byKey.set(entry.key, entry);
    insertSorted(listFor(entry.tab), entry);
    markDirty(entry);
    trim(entry.tab);
    emit();
    return true;
}

export function addDelete(entry: DeleteEntry) {
    return add(entry);
}

export function addEdit(entry: EditEntry) {
    return add(entry);
}

export function addGhostPing(entry: GhostPingEntry) {
    return add(entry);
}

export function updateEntry(entry: LogEntry) {
    if (!byKey.has(entry.key)) return;
    markDirty(entry);
    emit();
}

function trim(tab: Tab) {
    const list = listFor(tab);
    const limit = Math.max(1, Math.round(settings.store.savedLimit || 1000));
    if (list.length <= limit) return;
    removeEntries(list.slice(limit).map(e => e.key), false);
}

/** Drops entries past the retention period and over the per-tab limit. */
export function prune() {
    const days = Math.max(1, settings.store.retentionDays || 30);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const old: string[] = [];
    for (const tab of ["deleted", "edited", "ghostPings"] as Tab[]) {
        for (const entry of listFor(tab)) {
            if (entryTime(entry) < cutoff) old.push(entry.key);
        }
    }
    if (old.length) removeEntries(old, false);
    (["deleted", "edited", "ghostPings"] as Tab[]).forEach(trim);
    emit();
}

export function removeEntries(keys: string[], notify = true) {
    if (!keys.length) return;
    const removed: LogEntry[] = [];
    for (const key of keys) {
        const entry = byKey.get(key);
        if (!entry) continue;
        byKey.delete(key);
        pendingSet.delete(key);
        pendingDel.add(key);
        removed.push(entry);
    }
    if (!removed.length) return;

    const removedKeys = new Set(removed.map(e => e.key));
    for (const tab of ["deleted", "edited", "ghostPings"] as Tab[]) {
        if (removed.some(e => e.tab === tab)) {
            entries[tab] = entries[tab].filter(e => !removedKeys.has(e.key)) as any;
        }
    }

    forgetMediaOf(removed);
    scheduleFlush();
    if (notify) emit();
}

export function clearTab(tab: Tab) {
    removeEntries(listFor(tab).map(e => e.key));
}

export function clearAll() {
    removeEntries([...byKey.keys()]);
}

/** Deleted messages of a channel that should be shown in chat again. */
export function getRestorableDeletes(channelId: string): DeleteEntry[] {
    return entries.deleted.filter(e => !e.hiddenInChat && e.message.channelId === channelId);
}

export function findDeleteEntry(channelId: string, messageId: string): DeleteEntry | undefined {
    return byKey.get(`d:${channelId}:${messageId}`) as DeleteEntry | undefined;
}

/** Finds the log menu entry that best matches a chat message, for "Open in log menu". */
export function findEntryForMessage(messageId: string): LogEntry | undefined {
    for (const tab of ["deleted", "edited", "ghostPings"] as Tab[]) {
        const found = listFor(tab).find(e => entryMessageId(e) === messageId);
        if (found) return found;
    }
    return undefined;
}

export function exportJson(): string {
    return JSON.stringify({
        plugin: "BestMessageLogger",
        version: 3,
        exportedAt: new Date().toISOString(),
        data: entries
    }, null, 2);
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export function loadLogs(): Promise<void> {
    return loadPromise ??= (async () => {
        try {
            const stored = await DataStore.values<LogEntry>(getLogsDb());
            for (const entry of stored) {
                if (!entry?.key || !entry.tab || byKey.has(entry.key)) continue;
                if (!(entry.tab in entries)) continue;
                byKey.set(entry.key, entry);
                listFor(entry.tab).push(entry);
            }
            migrateLegacyLogs();
            for (const tab of ["deleted", "edited", "ghostPings"] as Tab[]) {
                listFor(tab).sort((a, b) => entryTime(b).localeCompare(entryTime(a)));
            }
            prune();
            void collectOrphanMedia();
        } catch (e) {
            logger.error("Loading logs failed", e);
        }
        emit();
    })();
}

export function resetLoaded() {
    loadPromise = null;
    byKey.clear();
    entries.deleted = [];
    entries.edited = [];
    entries.ghostPings = [];
}

/** Moves logs saved by version 2 (localStorage) into the new storage, when that storage is readable. */
function migrateLegacyLogs() {
    const LEGACY_KEY = "vc-best-message-logger-v2";
    let storage: Storage | null = null;
    try { storage = window.localStorage ?? null; } catch { }
    const text = storage?.getItem(LEGACY_KEY);
    if (!storage || !text) return;

    try {
        const data = JSON.parse(text);
        const convert = (m: any): LogMessage => ({
            id: String(m.id),
            channelId: String(m.channelId),
            guildId: m.guildId ?? null,
            guildName: m.guildName && m.guildName !== m.guildId ? m.guildName : null,
            guildIconUrl: null,
            channelName: m.channelName ?? null,
            author: {
                id: m.authorId ?? null,
                name: String(m.authorTag ?? "Unknown User").replace(/ \(@.+\)$/, ""),
                username: /\(@(.+)\)$/.exec(m.authorTag ?? "")?.[1] ?? "unknown",
                avatarUrl: userAvatarUrl(m.authorId, null),
                bot: !!m.isBot
            },
            content: m.content ?? "",
            timestamp: m.timestamp ?? new Date().toISOString(),
            editedTimestamp: m.editedTimestamp ?? null,
            mentionEveryone: !!m.mentionEveryone,
            mentionIds: m.mentions ?? [],
            mentionRoleIds: [],
            mentionNames: {},
            media: (m.attachments ?? []).map((a: any, i: number): LogMedia => ({
                key: `att-${a.id ?? i}`,
                kind: /^image\//.test(a.contentType) ? "image" : /^video\//.test(a.contentType) ? "video" : /^audio\//.test(a.contentType) ? "audio" : "file",
                url: a.url ?? "",
                proxyUrl: a.url ?? "",
                filename: a.filename ?? "attachment",
                contentType: a.contentType ?? "",
                size: 0,
                source: "attachment"
            })),
            embeds: [],
            extraText: [],
            forwarded: null,
            replyTo: null
        });

        for (const d of data.deleted ?? []) {
            const message = convert(d);
            const entry: DeleteEntry = { tab: "deleted", key: `d:${message.channelId}:${message.id}`, deletedAt: d.deletedAt, kind: d.kind ?? "delete", message, raw: { id: message.id, channel_id: message.channelId, content: message.content, author: {} }, rawFromApi: false, hiddenInChat: true };
            if (!byKey.has(entry.key)) { byKey.set(entry.key, entry); entries.deleted.push(entry); markDirty(entry); }
        }
        for (const e of data.edited ?? []) {
            const before = convert(e.before);
            const after = convert(e.after);
            const entry: EditEntry = { tab: "edited", key: `e:${after.id}:${e.editedAt}`, editedAt: e.editedAt, messageId: after.id, channelId: after.channelId, before, after };
            if (!byKey.has(entry.key)) { byKey.set(entry.key, entry); entries.edited.push(entry); markDirty(entry); }
        }
        for (const g of data.ghostPings ?? []) {
            const message = convert(g);
            const entry: GhostPingEntry = { tab: "ghostPings", key: `g:${message.id}:${g.reason}`, detectedAt: g.detectedAt, reason: g.reason, message };
            if (!byKey.has(entry.key)) { byKey.set(entry.key, entry); entries.ghostPings.push(entry); markDirty(entry); }
        }
        storage.removeItem(LEGACY_KEY);
        logger.info("Moved old logs to the new storage");
    } catch (e) {
        logger.error("Could not read old logs", e);
    }
}

// ---------------------------------------------------------------------------
// Offline media copies
// ---------------------------------------------------------------------------

const MAX_PARALLEL_DOWNLOADS = 3;
const downloadQueue: Array<() => Promise<void>> = [];
let activeDownloads = 0;

function mediaKey(messageId: string, media: LogMedia) {
    return `${messageId}:${media.key}`;
}

function pumpDownloads() {
    while (activeDownloads < MAX_PARALLEL_DOWNLOADS && downloadQueue.length) {
        const task = downloadQueue.shift()!;
        activeDownloads++;
        task().finally(() => {
            activeDownloads--;
            pumpDownloads();
        });
    }
}

/**
 * Media urls the chat already showed for a message. The app has these loaded, so they still
 * work for a while after Discord removes the original files. Keyed by attachment id.
 */
function urlsShownInChat(message: LogMessage): Map<string, string[]> {
    const found = new Map<string, string[]>();
    const element = document.getElementById(`chat-messages-${message.channelId}-${message.id}`);
    if (!element) return found;
    element.querySelectorAll<HTMLElement>("img, video, source, a[href]").forEach(el => {
        const url = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src || (el as HTMLAnchorElement).href || "";
        const attachmentId = /\/attachments\/\d+\/(\d+)\//.exec(url)?.[1];
        if (!attachmentId || !discordMediaUrl(url)) return;
        const list = found.get(attachmentId) ?? [];
        if (!list.includes(url)) list.push(url);
        found.set(attachmentId, list);
    });
    return found;
}

function attachmentIdOf(item: LogMedia): string | null {
    return /att-(\d+)$/.exec(item.key)?.[1] ?? null;
}

/**
 * Keeps the media of a deleted message on this computer. It uses, in order: the copy the media
 * cache made before the delete, a fresh download, and the preview the chat already loaded.
 */
export function saveMediaOffline(message: LogMessage, media: LogMedia[] = message.media) {
    if (!settings.store.saveMedia) return;
    const maxBytes = Math.max(1, settings.store.maxMediaSizeMB || 25) * 1024 * 1024;
    // read the chat now, while the message is still on screen
    const shown = urlsShownInChat(message);

    for (const item of media) {
        if (item.saved || (item.size && item.size > maxBytes)) continue;
        const attachmentId = attachmentIdOf(item);
        const previews = attachmentId ? shown.get(attachmentId) ?? [] : [];
        downloadQueue.push(async () => {
            const blob = await takeCachedMedia(message.id, item)
                ?? await fetchBlob([discordMediaUrl(item.proxyUrl), discordMediaUrl(item.url)], maxBytes)
                ?? await fetchBlob(previews, maxBytes);
            if (!blob) return;
            try {
                await DataStore.set(mediaKey(message.id, item), blob, getMediaDb());
                item.saved = true;
                for (const entry of byKey.values()) {
                    if (entryMessageId(entry) === message.id) markDirty(entry);
                }
                emit();
            } catch (e) {
                logger.error("Saving media failed", e);
            }
        });
    }
    pumpDownloads();
}

export async function getSavedMediaBlob(messageId: string, media: LogMedia): Promise<Blob | null> {
    if (!media.saved) return null;
    try {
        return (await DataStore.get<Blob>(mediaKey(messageId, media), getMediaDb())) ?? null;
    } catch {
        return null;
    }
}

function referencedMessageIds(): Set<string> {
    const ids = new Set<string>();
    for (const entry of byKey.values()) ids.add(entryMessageId(entry));
    return ids;
}

function forgetMediaOf(removed: LogEntry[]) {
    const stillUsed = referencedMessageIds();
    const keys: string[] = [];
    for (const entry of removed) {
        const id = entryMessageId(entry);
        if (stillUsed.has(id)) continue;
        const lists = entry.tab === "edited" ? [entry.before.media, entry.after.media] : [entry.message.media];
        for (const list of lists) {
            for (const m of list) if (m.saved) keys.push(mediaKey(id, m));
        }
    }
    if (keys.length) DataStore.delMany(keys, getMediaDb()).catch(e => logger.error("Removing media failed", e));
}

/** Removes stored media whose log entries are gone. */
async function collectOrphanMedia() {
    try {
        const keys = await DataStore.keys<string>(getMediaDb());
        const used = referencedMessageIds();
        const orphans = keys.filter(k => !used.has(String(k).split(":")[0]));
        if (orphans.length) await DataStore.delMany(orphans, getMediaDb());
    } catch (e) {
        logger.error("Cleaning media failed", e);
    }
}
