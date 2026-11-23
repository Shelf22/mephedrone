/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 KernelSpecter
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Message } from "@vencord/discord-types";
import { MessageReferenceType } from "@vencord/discord-types/enums";
import { MessageStore } from "@webpack/common";

import { ChainMode } from "./settings";

/**
 * A reply never expands into more than this many deletions. An unbounded walk can
 * sweep up an unrelated conversation that happens to sit beside the reply.
 */
export const MAX_CHAIN = 25;

/** MessageStore.getMessage is typed as always returning a Message. It does not. */
export function getMessage(channelId: string, messageId: string): Message | undefined {
    try {
        return MessageStore.getMessage(channelId, messageId) ?? undefined;
    } catch {
        return undefined;
    }
}

/**
 * The id of the message this one replies to in the same channel, or null.
 *
 * MESSAGE_CREATE carries the raw gateway payload, where the field is message_reference.
 * Only a message from the store has messageReference, so reading that alone meant the
 * reply trigger never saw a single reply.
 */
export function repliedTo(message: Message): string | null {
    const reference = (message as any).message_reference ?? message.messageReference;
    if (!reference?.message_id) return null;

    // A forward carries a reference too, and can point into this very channel. It is
    // not a reply to you.
    if (reference.type === MessageReferenceType.FORWARD) return null;
    if (reference.channel_id !== message.channel_id) return null;

    return reference.message_id;
}

function cachedMessages(channelId: string): Message[] {
    try {
        return MessageStore.getMessages(channelId)?._array ?? [];
    } catch {
        return [];
    }
}

/**
 * The run of consecutive messages by you that `rootId` belongs to, stopping dead at
 * the first message by anyone else in either direction. This is what "delete the
 * whole burst" should have meant.
 */
export function collectBurst(channelId: string, rootId: string, selfId: string): Message[] {
    const all = cachedMessages(channelId);
    const index = all.findIndex(m => m.id === rootId);

    if (index === -1) {
        const only = getMessage(channelId, rootId);
        return only?.author?.id === selfId ? [only] : [];
    }

    // If the root is not yours, there is no burst of yours to collect. Without this the
    // walk would step straight past it and sweep up whoever's messages sit either side.
    if (all[index].author?.id !== selfId) return [];

    const run: Message[] = [];

    for (let i = index; i >= 0 && run.length < MAX_CHAIN; i--) {
        if (all[i].author?.id !== selfId) break;
        run.unshift(all[i]);
    }

    for (let i = index + 1; i < all.length && run.length < MAX_CHAIN; i++) {
        if (all[i].author?.id !== selfId) break;
        run.push(all[i]);
    }

    return run;
}

/**
 * `rootId` plus the messages it was itself replying to, following message_reference
 * upward while the author is still you and the reference stays in this channel.
 */
export function collectReplyLineage(channelId: string, rootId: string, selfId: string): Message[] {
    const seen = new Set<string>();
    const lineage: Message[] = [];

    let cursor: string | undefined = rootId;

    while (cursor && lineage.length < MAX_CHAIN && !seen.has(cursor)) {
        seen.add(cursor);

        const message = getMessage(channelId, cursor);
        if (!message || message.author?.id !== selfId) break;

        lineage.push(message);

        const reference = message.messageReference;
        cursor = reference?.channel_id === channelId ? reference.message_id : undefined;
    }

    return lineage;
}

export function expandTrigger(mode: ChainMode, channelId: string, rootId: string, selfId: string): Message[] {
    switch (mode) {
        case "burst":
            return collectBurst(channelId, rootId, selfId);
        case "chain":
            return collectReplyLineage(channelId, rootId, selfId);
        default: {
            const only = getMessage(channelId, rootId);
            return only?.author?.id === selfId ? [only] : [];
        }
    }
}
