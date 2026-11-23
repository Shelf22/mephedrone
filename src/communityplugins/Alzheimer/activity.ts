/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings as pinSettings } from "@plugins/pinDms";
import { proxyLazy } from "@utils/lazy";
import { ChannelStore, Flux, FluxDispatcher, MessageStore, ReadStateStore, SnowflakeUtils, UserStore } from "@webpack/common";

import { Activity, newestId } from "./core";

export function pinnedIds(userId = UserStore.getCurrentUser()?.id) {
    if (!userId) return [];
    const categories = pinSettings.store.userBasedCategoryList[userId] ?? [];
    return [...new Set(categories.flatMap(category => category.channels))]
        .filter(id => ChannelStore.getChannel(id)?.isDM());
}

export const ActivityStore = proxyLazy(() => {
    class AlzheimerActivityStore extends Flux.Store {
        enabled = false;
        private missing = new Map<string, Activity | null>();
        private deleted = new Set<string>();

        getActivity(channelId: string): Activity | undefined {
            const cached = MessageStore.getLastMessage(channelId);
            const fallback = this.missing.get(channelId);
            const id = newestId([
                ChannelStore.getChannel(channelId)?.lastMessageId,
                ReadStateStore.lastMessageId(channelId),
                cached?.id,
                fallback?.messageId
            ], this.deleted);
            if (!id) return;
            return {
                messageId: id,
                timestamp: SnowflakeUtils.extractTimestamp(id),
                authorId: cached?.id === id ? cached.author.id : fallback?.messageId === id ? fallback.authorId : undefined
            };
        }

        needsFetch(channelId: string) {
            const activity = this.getActivity(channelId);
            return activity ? !activity.authorId : !this.missing.has(channelId);
        }

        receive(channelId: string, activity: Activity | null) {
            this.missing.set(channelId, activity);
            this.emitChange();
        }

        removeMessages(channelId: string, ids: string[]) {
            if (!pinnedIds().includes(channelId)) return false;
            for (const id of ids) this.deleted.add(id);
            this.missing.delete(channelId);
            this.emitChange();
            return true;
        }

        reset(enabled = this.enabled) {
            this.enabled = enabled;
            this.missing.clear();
            this.deleted.clear();
            this.emitChange();
        }
    }

    return new AlzheimerActivityStore(FluxDispatcher);
});
