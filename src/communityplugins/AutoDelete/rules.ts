/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 KernelSpecter
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Channel, Message } from "@vencord/discord-types";
import { ChannelStore } from "@webpack/common";

import { parseDuration } from "./duration";
import { RuleMap, settings } from "./settings";

/** 0 is a real value ("never delete here"), so "no rule at all" has to be null. */
export type Ttl = number | null;

export interface Resolution {
    ttl: Ttl;
    /** Which knob decided it, so the UI can explain itself instead of just showing a number. */
    source: "channel" | "category" | "guild" | "default" | "out-of-scope";
}

function ruleFor(rules: RuleMap, id: string | undefined | null): number | undefined {
    if (!id) return undefined;
    const value = rules[id];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function defaultTtl(): number | null {
    return parseDuration(settings.store.defaultTimer);
}

/**
 * Most specific rule wins: channel, then its category, then the server, then the
 * global default if the scope setting lets it reach here.
 */
export function resolveTtl(channel: Channel | undefined | null): Resolution {
    if (!channel) return { ttl: null, source: "out-of-scope" };

    const rules = settings.store.rules ?? {};

    const channelRule = ruleFor(rules, channel.id);
    if (channelRule !== undefined) return { ttl: channelRule, source: "channel" };

    const categoryRule = channel.guild_id ? ruleFor(rules, channel.parent_id) : undefined;
    if (categoryRule !== undefined) return { ttl: categoryRule, source: "category" };

    const guildRule = ruleFor(rules, channel.guild_id);
    if (guildRule !== undefined) return { ttl: guildRule, source: "guild" };

    const isPrivate = !channel.guild_id;

    // An unset scope means the cautious option, never "everywhere".
    switch (settings.store.scope ?? "listed") {
        case "listed":
            return { ttl: null, source: "out-of-scope" };
        case "guilds":
            if (isPrivate) return { ttl: null, source: "out-of-scope" };
            break;
        case "dms":
            if (!isPrivate) return { ttl: null, source: "out-of-scope" };
            break;
    }

    return { ttl: defaultTtl(), source: "default" };
}

export function resolveTtlForChannelId(channelId: string): Resolution {
    return resolveTtl(ChannelStore.getChannel(channelId));
}

export function setRule(id: string, ttlSeconds: number | null) {
    const next = { ...(settings.store.rules ?? {}) };
    if (ttlSeconds == null) delete next[id];
    else next[id] = Math.max(0, Math.round(ttlSeconds));
    settings.store.rules = next;
}

/**
 * Reasons a message is off limits even where a timer applies. Returns the reason so
 * callers can say why nothing happened.
 */
export function exemption(message: Message): string | null {
    if (settings.store.skipPinned && message.pinned) return "pinned";
    if (settings.store.skipAttachments && message.attachments?.length) return "has an attachment";

    const marker = settings.store.keepMarker?.trim();
    if (marker && message.content?.includes(marker)) return `contains ${marker}`;

    return null;
}
