/*
 * BestMessageLogger, a Vencord plugin by Kh8da
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { ChannelStore, SelectedChannelStore } from "@webpack/common";

import { isEphemeral, rawToLog, shouldIgnore, toRaw } from "./capture";
import { settings } from "./settings";
import type { LogMedia } from "./types";
import { discordMediaUrl, logger } from "./utils";

/*
 * Discord removes a message's files from its servers as soon as the message is deleted, so
 * downloading them after the delete often fails. This keeps a temporary copy of the media in
 * channels you open, so a deleted message's files are already on this computer. The cache has
 * a size limit and drops the oldest files first.
 */

const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const MAX_PARALLEL = 2;
const INDEX_KEY = "index";

type IndexEntry = { size: number; t: number; };

let blobDb: DataStore.UseStore | null = null;
let indexDb: DataStore.UseStore | null = null;
let index: Map<string, IndexEntry> | null = null;
let indexPromise: Promise<Map<string, IndexEntry>> | null = null;
let totalBytes = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let enabled = false;

const queue: Array<() => Promise<void>> = [];
let active = 0;
const inFlight = new Map<string, Promise<Blob | null>>();

function getBlobDb() {
    return blobDb ??= DataStore.createStore("BestMessageLoggerCache", "blobs");
}

function getIndexDb() {
    return indexDb ??= DataStore.createStore("BestMessageLoggerCacheIndex", "index");
}

function maxFileBytes() {
    return Math.max(1, settings.store.maxMediaSizeMB || 25) * 1024 * 1024;
}

function budgetBytes() {
    return Math.max(64, settings.store.mediaCacheMB || 512) * 1024 * 1024;
}

export function cacheKey(messageId: string, media: LogMedia) {
    return `${messageId}:${media.key}`;
}

function loadIndex(): Promise<Map<string, IndexEntry>> {
    return indexPromise ??= (async () => {
        const map = new Map<string, IndexEntry>();
        try {
            const saved = await DataStore.get<Record<string, IndexEntry>>(INDEX_KEY, getIndexDb());
            const cutoff = Date.now() - MAX_AGE;
            const expired: string[] = [];
            for (const [key, value] of Object.entries(saved ?? {}).sort((a, b) => a[1].t - b[1].t)) {
                if (value.t < cutoff) expired.push(key);
                else map.set(key, value);
            }
            if (expired.length) await DataStore.delMany(expired, getBlobDb());
        } catch (e) {
            logger.error("Loading the media cache failed", e);
        }
        index = map;
        totalBytes = 0;
        for (const value of map.values()) totalBytes += value.size;
        return map;
    })();
}

function scheduleIndexSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => void saveIndex(), 2000);
}

async function saveIndex() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    if (!index) return;
    try {
        await DataStore.set(INDEX_KEY, Object.fromEntries(index), getIndexDb());
    } catch (e) {
        logger.error("Saving the media cache index failed", e);
    }
}

/** Drops the oldest files until the cache fits its size limit. */
async function evict() {
    if (!index) return;
    const limit = budgetBytes();
    if (totalBytes <= limit) return;
    const drop: string[] = [];
    // the index keeps insertion order, which is oldest first
    for (const [key, value] of index) {
        if (totalBytes <= limit * 0.9) break;
        drop.push(key);
        totalBytes -= value.size;
        index.delete(key);
    }
    if (drop.length) {
        try {
            await DataStore.delMany(drop, getBlobDb());
        } catch (e) {
            logger.error("Trimming the media cache failed", e);
        }
    }
    scheduleIndexSave();
}

export async function fetchBlob(urls: string[], maxBytes: number): Promise<Blob | null> {
    for (const url of urls) {
        if (!url || !/^https:/i.test(url)) continue;
        try {
            const res = await fetch(url, { cache: "force-cache" });
            if (!res.ok) continue;
            const length = Number(res.headers.get("content-length") || 0);
            if (length && length > maxBytes) return null;
            const blob = await res.blob();
            if (blob.size > maxBytes || blob.size === 0) continue;
            return blob;
        } catch {
            // CORS or network failure, try the next url
        }
    }
    return null;
}

function pump() {
    while (active < MAX_PARALLEL && queue.length) {
        const task = queue.shift()!;
        active++;
        task().finally(() => {
            active--;
            pump();
        });
    }
}

function hasMedia(message: any): boolean {
    return !!(message.attachments?.length || message.embeds?.length || message.sticker_items?.length
        || message.components?.length || message.message_snapshots?.length);
}

function enqueue(messageId: string, item: LogMedia) {
    const key = cacheKey(messageId, item);
    if (index?.has(key) || inFlight.has(key)) return;

    let resolve!: (blob: Blob | null) => void;
    inFlight.set(key, new Promise(r => resolve = r));

    queue.push(async () => {
        let blob: Blob | null = null;
        try {
            if (enabled) {
                // the original first, the resized proxy copy as a fallback
                blob = await fetchBlob([discordMediaUrl(item.url), discordMediaUrl(item.proxyUrl)], maxFileBytes());
                if (blob && index) {
                    await DataStore.set(key, blob, getBlobDb());
                    index.delete(key);
                    index.set(key, { size: blob.size, t: Date.now() });
                    totalBytes += blob.size;
                    scheduleIndexSave();
                    void evict();
                }
            }
        } catch (e) {
            logger.error("Caching media failed", e);
        } finally {
            inFlight.delete(key);
            resolve(blob);
        }
    });
    pump();
}

/**
 * Keeps a temporary copy of a message's media. Called for messages in channels you open and
 * for new messages in the channel you are looking at or in your DMs.
 */
export function cacheMessageMedia(message: any) {
    if (!enabled || !settings.store.saveMedia || !settings.store.cacheMedia) return;
    if (!message?.id || !message.channel_id || message.__bml || !hasMedia(message)) return;
    if (isEphemeral(message) || shouldIgnore(message)) return;

    const maxBytes = maxFileBytes();
    void loadIndex().then(() => {
        try {
            const log = rawToLog(toRaw(message));
            for (const item of log.media) {
                if (item.size && item.size > maxBytes) continue;
                enqueue(log.id, item);
            }
        } catch (e) {
            logger.error("Reading message media failed", e);
        }
    });
}

/** Whether new messages in this channel should have their media cached right away. */
export function isWatchedChannel(channelId: string): boolean {
    if (SelectedChannelStore.getChannelId() === channelId) return true;
    try {
        return !ChannelStore.getChannel(channelId)?.guild_id;
    } catch {
        return false;
    }
}

/**
 * Hands over the cached copy of a deleted message's file (waiting for a download that is
 * still running) and removes it from the cache.
 */
export async function takeCachedMedia(messageId: string, item: LogMedia): Promise<Blob | null> {
    const key = cacheKey(messageId, item);
    const running = inFlight.get(key);
    if (running) {
        const blob = await running;
        if (blob) void dropFromCache(key);
        return blob;
    }
    const map = await loadIndex();
    if (!map.has(key)) return null;
    try {
        const blob = (await DataStore.get<Blob>(key, getBlobDb())) ?? null;
        void dropFromCache(key);
        return blob;
    } catch {
        return null;
    }
}

async function dropFromCache(key: string) {
    const entry = index?.get(key);
    if (!entry || !index) return;
    index.delete(key);
    totalBytes -= entry.size;
    scheduleIndexSave();
    try {
        await DataStore.delMany([key], getBlobDb());
    } catch { }
}

export function startMediaCache() {
    enabled = true;
    void loadIndex();
}

export function stopMediaCache() {
    // queued tasks still run, see that the cache is off and finish without downloading
    enabled = false;
    void saveIndex();
}
