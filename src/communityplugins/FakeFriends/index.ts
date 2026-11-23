import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { RelationshipStore, UserStore } from "@webpack/common";

interface FakeFriend {
    id: string;
    nickname?: string;
}

const settings = definePluginSettings({
    allowedAccountIds: {
        type: OptionType.STRING,
        description: "Comma-separated Discord user ID(s) this spoof should apply to. Leave blank to apply on every account.",
        default: "",
        restartNeeded: false
    },
    fakeFriendsData: {
        type: OptionType.STRING,
        description: "JSON array of fake friends. Needs a REAL Discord user ID so the profile/avatar can load. Their online/idle/dnd/invisible status is always their real one - not editable here. Example: [{\"id\":\"REPLACE_WITH_A_USER_ID\",\"nickname\":\"TestFriend\"}]",
        default: "[]",
        restartNeeded: false
    }
});

function isAccountAllowed(): boolean {
    const raw = settings.store.allowedAccountIds?.trim();
    if (!raw) return true;
    const allowedIds = raw.split(",").map(id => id.trim()).filter(Boolean);
    const currentUser = UserStore.getCurrentUser();
    if (!currentUser) return false;
    return allowedIds.includes(currentUser.id);
}

function getFakeFriends(): FakeFriend[] {
    try {
        return JSON.parse(settings.store.fakeFriendsData || "[]");
    } catch {
        return [];
    }
}

// Forces the friends-list UI (and anything else subscribed to these stores)
// to actually re-render. Dispatching a made-up action type does NOT do this —
// the store's internal reducer has to match a real action before it calls
// emitChange() itself, so a fake type is silently ignored. Calling
// emitChange() directly bypasses that and notifies subscribers immediately.
function forceUIRefresh() {
    try {
        // @ts-ignore - emitChange is inherited from Flux's EventEmitter base class
        // but isn't in the store's public type definitions.
        RelationshipStore.emitChange?.();
    } catch (err) {
        console.error("[FakeFriends] Failed to refresh RelationshipStore", err);
    }
}

export default definePlugin({
    name: "FakeFriends",
    description: "Spoofs your friend list to show fake added accounts, complete with nicknames and full profiles when clicked. Online/idle/dnd status always reflects their real presence.",
    tags: ["Appearance", "FriendList"],
    authors: [{ name: "Custom", id: 0n }],
    settings,

    start() {
        if (!isAccountAllowed()) {
            console.warn("[FakeFriends] Current account is not in allowedAccountIds, plugin will not activate.");
            return;
        }

        const fakeFriends = getFakeFriends();
        if (fakeFriends.length === 0) {
            console.warn("[FakeFriends] fakeFriendsData is empty or failed to parse - nothing to show. Check your JSON in plugin settings.");
        }

        // Patch a method on a store only if it actually exists on this client
        // build. Discord renames/removes internal store methods between
        // versions (e.g. getType -> getRelationshipType), so blindly binding
        // one that's missing throws and — since this used to be one long
        // synchronous block — silently aborted every override after it.
        // Patching each one independently means a single renamed/missing
        // method degrades gracefully instead of breaking the whole plugin.
        const patch = (store: any, methodName: string, makeOverride: (original: (...args: any[]) => any) => (...args: any[]) => any) => {
            let fn: any;
            try {
                fn = store?.[methodName];
            } catch (err) {
                console.warn(`[FakeFriends] Reading ${methodName} threw (store likely unresolved), skipping`, err);
                return;
            }
            if (typeof fn !== "function") {
                console.warn(`[FakeFriends] ${methodName} not found on store, skipping (Discord may have renamed it, or the store never resolved)`);
                return;
            }
            const original = fn.bind(store);
            this.originals ??= {};
            this.originals[methodName] = original;
            store[methodName] = makeOverride(original);
        };

        this.originals = {};

        // Your console output confirmed this build calls it getMutableRelationships,
        // not getRelationships. It may return a Map (hence "Mutable") or a plain
        // object depending on version, so handle both shapes.
        patch(RelationshipStore, "getMutableRelationships", original => () => {
            const result = original();
            const fakeFriends = getFakeFriends();
            if (result instanceof Map) {
                const merged = new Map(result);
                fakeFriends.forEach(f => {
                    if (!merged.has(f.id)) merged.set(f.id, 1); // 1 = Friend
                });
                return merged;
            }
            const merged = { ...result };
            fakeFriends.forEach(f => {
                if (!merged[f.id]) merged[f.id] = 1; // 1 = Friend
            });
            return merged;
        });

        patch(RelationshipStore, "getFriendIDs", original => () => {
            const result = original();
            const fakeIds = getFakeFriends().map(f => f.id).filter(id => !result.includes(id));
            return [...result, ...fakeIds];
        });

        // Different Discord client builds expose this under different names -
        // patch whichever exist so the "are we friends" check used by profile
        // popouts, the Add Friend button, DM list, etc. all agree.
        patch(RelationshipStore, "getType", original => (id: string) => {
            if (getFakeFriends().some(f => f.id === id)) return 1; // 1 = Friend
            return original(id);
        });
        patch(RelationshipStore, "getRelationshipType", original => (id: string) => {
            if (getFakeFriends().some(f => f.id === id)) return 1; // 1 = Friend
            return original(id);
        });

        patch(RelationshipStore, "isFriend", original => (id: string) => {
            if (getFakeFriends().some(f => f.id === id)) return true;
            return original(id);
        });

        patch(RelationshipStore, "getNickname", original => (id: string) => {
            const fake = getFakeFriends().find(f => f.id === id);
            if (fake) return fake.nickname || original(id);
            return original(id);
        });

        console.log("[FakeFriends] Patched methods:", Object.keys(this.originals));

        // Fetch the real user profiles FIRST, then force a UI refresh.
        // If we don't wait for the fetch to finish, avatars/usernames won't
        // be cached yet and the row can render blank or fall back to "Unknown User".
        const promises = fakeFriends.map(f => {
            if (UserStore.getUser(f.id)) return Promise.resolve();
            return UserStore.fetchUser(f.id)
                .catch(err => {
                    console.error(`[FakeFriends] Failed to fetch user ${f.id} - is that a valid, real Discord user ID?`, err);
                });
        });

        Promise.all(promises).then(forceUIRefresh);

        // Also refresh immediately in case the users are already cached
        forceUIRefresh();
    },

    stop() {
        // Restore original functions to prevent crashes when disabled
        const o = this.originals || {};
        try {
            if (o.getMutableRelationships) RelationshipStore.getMutableRelationships = o.getMutableRelationships;
            if (o.getFriendIDs) RelationshipStore.getFriendIDs = o.getFriendIDs;
            if (o.getType) RelationshipStore.getType = o.getType;
            if (o.getRelationshipType) RelationshipStore.getRelationshipType = o.getRelationshipType;
            if (o.isFriend) RelationshipStore.isFriend = o.isFriend;
            if (o.getNickname) RelationshipStore.getNickname = o.getNickname;
        } catch (err) {
            console.error("[FakeFriends] Error restoring RelationshipStore methods", err);
        }
        forceUIRefresh();
    }
});
