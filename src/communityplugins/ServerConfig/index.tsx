import "./styles.css";

import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { findByPropsLazy } from "@webpack";
import { RestAPI, Text, Toasts } from "@webpack/common";

// Ported from the BetterDiscord "ServerConfig" plugin (Ekibunnel), with
// defaults matching this user's actual saved BD config, plus a DM-blocking
// feature the original never had.
// Applies your preferred notification settings (and optionally a nickname)
// the moment you join a brand new server.

const logger = new Logger("ServerConfig");

const GuildSettingsActions = findByPropsLazy("updateGuildNotificationSettings");
const NicknameActions = findByPropsLazy("changeNickname");
const VerificationActions = findByPropsLazy("submitVerificationForm");

// Ignore GUILD_CREATE events for servers you didn't *just* join (e.g. ones
// loaded on client startup) - mirrors the original plugin's 60s window.
const APPLY_WINDOW_MS = 60_000;

const settings = definePluginSettings({
    // This plugin acts silently and automatically, on servers you have not
    // joined yet, using whatever is configured below. Someone installing it for
    // the first time has no other place to find out what it is about to do to
    // their account, so it is spelled out here in full before the toggles.
    summary: {
        type: OptionType.COMPONENT,
        description: "What this plugin will do when you next join a server",
        component: () => {
            settings.use([
                "muted", "messageNotifications", "suppressEveryone", "suppressRoles",
                "mobilePush", "restrictDms", "nickname", "acceptTerms"
            ]);

            const s = settings.store;
            const notificationLabel = ["every message", "mentions only", "nothing"][s.messageNotifications] ?? "nothing";

            const effects = [
                s.muted && "mute the server",
                `set notifications to ${notificationLabel}`,
                s.suppressEveryone && "suppress @everyone and @here",
                s.suppressRoles && "suppress role mentions",
                s.mobilePush ? "allow mobile push" : "turn off mobile push",
                s.restrictDms && "block DMs from that server's members (an account privacy setting)",
                s.nickname && `set your nickname to "${s.nickname}"`,
                s.acceptTerms && "auto-accept the server's rules screening without showing it to you"
            ].filter(Boolean) as string[];

            return (
                <div className="vc-sc-settings-summary">
                    <Text variant="text-sm/semibold">
                        The next time you join a server, this plugin will automatically:
                    </Text>
                    <ul className="vc-sc-effect-list">
                        {effects.map(e => <li key={e}><Text variant="text-sm/normal">{e}</Text></li>)}
                    </ul>
                    <Text variant="text-xs/normal" className="vc-sc-settings-note">
                        This happens without a prompt, within 60 seconds of joining. It never
                        changes servers you are already in.
                    </Text>
                </div>
            );
        }
    },
    muted: {
        type: OptionType.BOOLEAN,
        description: "Mute new servers",
        default: true
    },
    messageNotifications: {
        type: OptionType.SELECT,
        description: "Notification setting for new servers",
        options: [
            { label: "All Messages", value: 0 },
            { label: "Only Mentions", value: 1 },
            { label: "Nothing", value: 2, default: true }
        ]
    },
    notifyHighlights: {
        type: OptionType.SELECT,
        description: "Include highlighted messages in notifications",
        options: [
            { label: "Off", value: 1 },
            { label: "On", value: 2, default: true }
        ]
    },
    suppressEveryone: {
        type: OptionType.BOOLEAN,
        description: "Suppress @everyone and @here",
        default: true
    },
    suppressRoles: {
        type: OptionType.BOOLEAN,
        description: "Suppress all role @mentions",
        default: true
    },
    mobilePush: {
        type: OptionType.BOOLEAN,
        description: "Allow mobile push notifications",
        default: false
    },
    muteScheduledEvents: {
        type: OptionType.BOOLEAN,
        description: "Mute new scheduled events",
        default: true
    },
    showAllChannels: {
        type: OptionType.BOOLEAN,
        description: "Show all channels (don't collapse to unreads-only)",
        default: false
    },
    hideMutedChannels: {
        type: OptionType.BOOLEAN,
        description: "Hide muted channels",
        default: true
    },
    restrictDms: {
        type: OptionType.BOOLEAN,
        // Off by default: unlike the options above, this one changes an
        // account-level privacy setting rather than a per-server notification
        // preference, and it is the least expected thing for a plugin named
        // "ServerConfig" to do. Opt in, don't opt out.
        description: "Block DMs from members of new servers you join (same as disabling \"Allow direct messages from server members\" in Privacy Settings)",
        default: false
    },
    nickname: {
        type: OptionType.STRING,
        description: "Nickname to set on join (blank = don't change). May silently fail if the server doesn't grant instant nickname permission.",
        default: ""
    },
    acceptTerms: {
        type: OptionType.BOOLEAN,
        description: "Experimental: auto-accept server membership screening. May break without warning.",
        default: false
    }
});

async function onGuildCreate({ guild }: any) {
    if (!guild?.joined_at) return;

    const joinedAt = new Date(guild.joined_at).getTime();
    if (Date.now() - joinedAt > APPLY_WINDOW_MS) return;

    GuildSettingsActions.updateGuildNotificationSettings(guild.id, {
        muted: settings.store.muted,
        message_notifications: settings.store.messageNotifications,
        notify_highlights: settings.store.notifyHighlights,
        suppress_everyone: settings.store.suppressEveryone,
        suppress_roles: settings.store.suppressRoles,
        mobile_push: settings.store.mobilePush,
        mute_scheduled_events: settings.store.muteScheduledEvents,
        flags: settings.store.showAllChannels ? 0 : 16384,
        hide_muted_channels: settings.store.hideMutedChannels
    });

    if (settings.store.nickname) {
        NicknameActions.changeNickname(guild.id, null, "@me", settings.store.nickname);
    }

    if (settings.store.restrictDms) {
        await queueRestrictGuildDms(guild.id);
    }
}

// "Allow direct messages from server members" isn't part of the guild
// notification-settings object above - it's a separate top-level list
// (`restricted_guilds`) on the same legacy settings object AnimatedStatus
// already patches for custom_status. PATCH replaces the whole array rather
// than merging, so we GET the current list first and append to it.
//
// That read-then-write is only safe if exactly one of them is ever in flight.
// Join two servers inside the 60s window (an invite burst, or a bot adding you
// to several) and two overlapping runs both GET the same list, then each PATCHes
// its own guild onto it - so whichever writes second erases the other. The user
// is told nothing and believes both servers are restricted. Hence the queue:
// every call is chained onto the previous one, so each GET always observes the
// preceding PATCH.
let dmRestrictQueue: Promise<void> = Promise.resolve();

// Second guard, for a different failure: Discord's settings read is eventually
// consistent, so a GET immediately after a PATCH can still return the old list.
// Anything we have already successfully written is remembered here and merged
// back in, so a stale read can't drop a guild we restricted moments ago.
const locallyRestricted = new Set<string>();

function queueRestrictGuildDms(guildId: string) {
    dmRestrictQueue = dmRestrictQueue.then(() => restrictGuildDms(guildId));
    return dmRestrictQueue;
}

async function restrictGuildDms(guildId: string) {
    try {
        const res: any = await RestAPI.get({ url: "/users/@me/settings" });
        const current: string[] = res?.body?.restricted_guilds ?? [];
        if (current.includes(guildId)) {
            locallyRestricted.add(guildId);
            return;
        }

        const merged = new Set([...current, ...locallyRestricted, guildId]);

        await RestAPI.patch({
            url: "/users/@me/settings",
            body: { restricted_guilds: [...merged] }
        });
        locallyRestricted.add(guildId);
    } catch (e) {
        // This is a privacy control. Failing silently to a console nobody has
        // open means believing DMs are blocked when they are not, so say so.
        logger.error("Failed to restrict DMs for new guild", e);
        Toasts.show({
            id: Toasts.genId(),
            type: Toasts.Type.FAILURE,
            message: "ServerConfig: couldn't block DMs from this server's members. Check Privacy Settings for that server."
        });
    }
}

function onGuildJoinRequestCreate({ guildId }: any) {
    if (settings.store.acceptTerms) {
        VerificationActions.submitVerificationForm(guildId, "@me");
    }
}

export default definePlugin({
    name: "ServerConfig",
    description: "Automatically applies your preferred notification/DM settings and nickname when you join a new server.",
    authors: [{ name: "isnuggs", id: 1483261914392825958n }],
    settings,
    flux: {
        GUILD_CREATE: onGuildCreate,
        GUILD_JOIN_REQUEST_CREATE: onGuildJoinRequestCreate
    }
});
