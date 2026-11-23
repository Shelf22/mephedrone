/*
 * BestMessageLogger, a Vencord plugin by Kh8da
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { updateMessage } from "@api/MessageUpdater";
import { ChannelStore, FluxDispatcher, MessageStore } from "@webpack/common";

import { cacheRaw, clearRawCache, forgetRaw, getCachedRaw, isEphemeral, looksLikeApiMessage, noteServerTime, pingsMe, rawToLog, sanitizeForChat, serverNowIso, shouldIgnore, toRaw } from "./capture";
import { cacheMessageMedia, isWatchedChannel } from "./media-cache";
import { settings } from "./settings";
import { addDelete, addEdit, addGhostPing, findDeleteEntry, getRestorableDeletes, saveMediaOffline, updateEntry } from "./store";
import type { DeleteEntry, RawMessage } from "./types";
import { compareSnowflakes, logger, toIso } from "./utils";

/*
 * Every message event goes through one Flux interceptor. It runs before Discord's stores handle
 * the event, so the message is still there when we read it, and it can add deleted messages to
 * the messages Discord loads for a channel.
 */

const HANDLED_EVENTS = ["MESSAGE_CREATE", "MESSAGE_UPDATE", "MESSAGE_DELETE", "MESSAGE_DELETE_BULK", "LOAD_MESSAGES_SUCCESS"];

let enabled = false;
let usingInterceptor = false;

const interceptor = (action: any) => {
    if (enabled && action?.type && HANDLED_EVENTS.includes(action.type)) {
        try {
            handleAction(action);
        } catch (e) {
            logger.error(`Handling ${action.type} failed`, e);
        }
    }
    // returning true would block the event
    return false;
};

const subscriber = (action: any) => interceptor(action);

export function startCapture() {
    enabled = true;
    const dispatcher = FluxDispatcher as any;
    if (typeof dispatcher.addInterceptor === "function") {
        dispatcher.addInterceptor(interceptor);
        usingInterceptor = true;
    } else {
        // Older clients: same handling, but deleted messages can't be put back into chat
        logger.warn("Flux interceptors are not available, restoring deleted messages in chat is off");
        for (const type of HANDLED_EVENTS) FluxDispatcher.subscribe(type as any, subscriber);
        usingInterceptor = false;
    }
}

export function stopCapture() {
    enabled = false;
    const dispatcher = FluxDispatcher as any;
    if (usingInterceptor) {
        const list = dispatcher._interceptors;
        if (Array.isArray(list)) {
            const index = list.indexOf(interceptor);
            if (index !== -1) list.splice(index, 1);
        }
    } else {
        for (const type of HANDLED_EVENTS) FluxDispatcher.unsubscribe(type as any, subscriber);
    }
    clearRawCache();
}

function defer(task: () => void) {
    setTimeout(() => {
        try {
            task();
        } catch (e) {
            logger.error("Logging failed", e);
        }
    }, 0);
}

function handleAction(action: any) {
    switch (action.type) {
        case "MESSAGE_CREATE":
            if (!action.optimistic) {
                cacheRaw(action.message);
                noteServerTime(action.message?.timestamp);
                if (action.message?.channel_id && isWatchedChannel(String(action.message.channel_id))) {
                    cacheMessageMedia(action.message);
                }
            }
            break;
        case "MESSAGE_UPDATE":
            onMessageUpdate(action.message);
            break;
        case "MESSAGE_DELETE":
            onMessageDelete(String(action.channelId), [String(action.id)], false, !!action.mlDeleted);
            break;
        case "MESSAGE_DELETE_BULK":
            onMessageDelete(String(action.channelId), (action.ids ?? []).map(String), true, false);
            break;
        case "LOAD_MESSAGES_SUCCESS":
            onMessagesLoaded(action);
            break;
    }
}

function onMessageUpdate(message: any) {
    if (!message?.id || !message.channel_id) return;
    const id = String(message.id);
    const channelId = String(message.channel_id);

    const cached = getCachedRaw(id);
    const record = cached ? null : MessageStore.getMessage(channelId, id) as any;
    const previous: any = cached ?? record;

    // Partial updates (embeds loading) only refresh the cache
    if (cached || message.author) cacheRaw(message);
    // links and gifs get their embeds in a later update
    if (message.embeds?.length && isWatchedChannel(channelId)) cacheMessageMedia(getCachedRaw(id) ?? message);

    if (!previous || isEphemeral(message) || previous.deleted) return;
    if (typeof message.content !== "string" || !message.edited_timestamp) return;
    if ((previous.content ?? "") === message.content) return;

    const after = { ...(cached ?? {}), ...message };
    if (!after.author) after.author = previous.author;
    if (shouldIgnore(after, true)) return;

    defer(() => logEdit(previous, after));
}

function logEdit(previousSource: any, afterSource: any) {
    const beforeRaw = toRaw(previousSource);
    const afterRaw = toRaw(afterSource);
    const before = rawToLog(beforeRaw);
    const after = rawToLog(afterRaw);
    const editedAt = toIso(afterRaw.edited_timestamp) ?? serverNowIso(before.timestamp);

    addEdit({
        tab: "edited",
        key: `e:${after.id}:${editedAt}`,
        editedAt,
        messageId: after.id,
        channelId: after.channelId,
        before,
        after
    });

    // keep a copy of attachments the edit removed
    const remaining = new Set(after.media.map(m => m.url));
    const removed = before.media.filter(m => !remaining.has(m.url));
    if (removed.length) saveMediaOffline(before, removed);

    if (settings.store.logGhostPings && pingsMe(beforeRaw) && !pingsMe(afterRaw)) {
        addGhostPing({
            tab: "ghostPings",
            key: `g:${before.id}:edited:${editedAt}`,
            detectedAt: serverNowIso(editedAt),
            reason: "edited",
            message: before
        });
    }
}

function onMessageDelete(channelId: string, ids: string[], isBulk: boolean, mlDeleted: boolean) {
    for (const id of ids) {
        if (mlDeleted) {
            // "Clear Message History" in chat: stop showing it in chat, keep it in the log menu
            const entry = findDeleteEntry(channelId, id);
            if (entry && !entry.hiddenInChat) {
                entry.hiddenInChat = true;
                updateEntry(entry);
            }
            continue;
        }

        const record = MessageStore.getMessage(channelId, id) as any;
        if (record?.deleted) continue;
        if (record?.state && record.state !== "SENT") continue;

        const source = getCachedRaw(id) ?? record;
        if (!source || isEphemeral(source) || shouldIgnore({ ...source, channel_id: channelId })) {
            forgetRaw(id);
            continue;
        }

        forgetRaw(id);
        defer(() => logDelete(source, channelId, isBulk));
    }
}

function logDelete(source: any, channelId: string, isBulk: boolean) {
    const raw = toRaw(source);
    raw.channel_id ||= channelId;
    if (!raw.guild_id) {
        const guildId = ChannelStore.getChannel(raw.channel_id)?.guild_id;
        if (guildId) raw.guild_id = guildId;
    }

    const message = rawToLog(raw);
    const now = serverNowIso(message.timestamp, message.editedTimestamp);
    const entry: DeleteEntry = {
        tab: "deleted",
        key: `d:${message.channelId}:${message.id}`,
        deletedAt: now,
        kind: isBulk ? "bulk-delete" : "delete",
        message,
        raw,
        rawFromApi: looksLikeApiMessage(source)
    };

    if (addDelete(entry)) saveMediaOffline(message);

    if (settings.store.logGhostPings && pingsMe(raw)) {
        addGhostPing({
            tab: "ghostPings",
            key: `g:${message.id}:deleted`,
            detectedAt: now,
            reason: "deleted",
            message
        });
    }
}

/**
 * Adds logged deleted messages to a batch of messages Discord loaded for a channel, but only
 * inside the range the batch covers, so they land in the right place and never twice.
 */
function onMessagesLoaded(action: any) {
    const messages: any[] = Array.isArray(action.messages) ? action.messages : [];
    for (const m of messages) {
        cacheRaw(m);
        cacheMessageMedia(m);
    }

    if (!settings.store.restoreDeletedInChat || !usingInterceptor || !action.channelId) return;
    const channelId = String(action.channelId);
    const restorable = getRestorableDeletes(channelId);
    if (!restorable.length) return;

    const loadedIds = new Set(messages.map(m => String(m.id)));
    let oldest: string | null = null;
    let newest: string | null = null;
    for (const m of messages) {
        const id = String(m.id);
        if (!oldest || compareSnowflakes(id, oldest) < 0) oldest = id;
        if (!newest || compareSnowflakes(id, newest) > 0) newest = id;
    }

    const merging = !!(action.isBefore || action.isAfter);
    const atLatest = !action.isBefore && !action.hasMoreAfter;
    const atOldest = !action.isAfter && action.hasMoreBefore === false;

    const toAdd: RawMessage[] = [];
    for (const entry of restorable) {
        const { id } = entry.message;
        if (loadedIds.has(id) || !entry.raw?.author?.id) continue;
        if (merging && MessageStore.getMessage(channelId, id)) continue;

        let fits: boolean;
        if (!oldest || !newest) {
            fits = !merging && atOldest;
        } else {
            fits = (compareSnowflakes(id, oldest) >= 0 && compareSnowflakes(id, newest) <= 0)
                || (compareSnowflakes(id, newest) > 0 && atLatest)
                || (compareSnowflakes(id, oldest) < 0 && atOldest);
        }
        if (fits) toAdd.push(sanitizeForChat(entry.raw, entry.rawFromApi));
    }
    if (!toAdd.length) return;

    const newestFirst = messages.length < 2 || compareSnowflakes(String(messages[0].id), String(messages[messages.length - 1].id)) > 0;
    const merged = [...messages, ...toAdd].sort((a, b) => compareSnowflakes(String(a.id), String(b.id)) * (newestFirst ? -1 : 1));
    action.messages = merged;

    // Make sure the restored messages are marked as deleted once Discord has built them
    const ids = toAdd.map(m => m.id);
    setTimeout(() => {
        for (const id of ids) {
            const record = MessageStore.getMessage(channelId, id) as any;
            if (!record || record.deleted) continue;
            updateMessage(channelId, id, {
                deleted: true,
                attachments: (record.attachments ?? []).map((a: any) => ({ ...a, deleted: true }))
            } as any);
        }
    }, 0);
}
