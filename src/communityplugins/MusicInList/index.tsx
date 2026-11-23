/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { Activity, User } from "@vencord/discord-types";
import { ActivityType } from "@vencord/discord-types/enums";
import { PresenceStore, React } from "@webpack/common";
import type { ComponentType, ReactNode } from "react";

const cl = classNameFactory("vc-music-in-list-");

type Location = "friends" | "dms" | "members";

const settings = definePluginSettings({
    friendsList: {
        type: OptionType.BOOLEAN,
        description: "Show the song in the friends list",
        default: true
    },
    dmList: {
        type: OptionType.BOOLEAN,
        description: "Show the song in the direct messages list",
        default: true
    },
    memberList: {
        type: OptionType.BOOLEAN,
        description: "Show the song in the server member list",
        default: false
    },
    activeNow: {
        type: OptionType.BOOLEAN,
        description: "Show the song in the Active Now panel cards",
        default: true
    },
    format: {
        type: OptionType.SELECT,
        description: "How to show the song",
        options: [
            { label: "Title — Artist", value: "title-artist", default: true },
            { label: "Title only", value: "title" }
        ]
    },
    spotifyOnly: {
        type: OptionType.BOOLEAN,
        description: "Only show Spotify, not other music apps (Last.fm, Apple Music, MusicRichPresence...)",
        default: false
    }
});

const locationSettings: Record<Location, "friendsList" | "dmList" | "memberList"> = {
    friends: "friendsList",
    dms: "dmList",
    members: "memberList"
};

/** Props of Discord's ActivityStatus component, plus the location passed by our patches */
interface ActivityStatusProps {
    user?: { bot?: boolean; } | null;
    activities?: Activity[] | null;
    textSize?: string;
    textClassName?: string;
    iconClassName?: string;
    hideTooltip?: boolean;
    vcMusicLocation?: Location;
}

/** An item of `currentActivities` in an Active Now card, as built by Discord's NowPlayingViewStore */
interface NowPlayingEntry {
    activity: Activity | null;
    application: unknown;
    activityUser: User;
    playingMembers: User[];
    startedPlayingTime?: number;
}

interface MusicInfo {
    /** The activities without the song, given back to Discord so the song isn't counted in "+N" */
    others: Activity[];
    text: string;
    textSize: string;
    textClassName?: string;
    iconClassName?: string;
    hideText: boolean;
    hideTooltip: boolean;
}

function isMusic(activity: Activity, spotifyOnly: boolean) {
    if (activity.type !== ActivityType.LISTENING) return false;
    return !spotifyOnly || (activity.name === "Spotify" && activity.party?.id?.startsWith("spotify:") === true);
}

// Keeps the same filtered array between renders, so Discord's useMemo calls on the activities stay cached
const splitCache = new WeakMap<Activity[], { spotifyOnly: boolean; music?: Activity; others: Activity[]; }>();

function splitActivities(activities: Activity[], spotifyOnly: boolean) {
    let split = splitCache.get(activities);
    if (split?.spotifyOnly !== spotifyOnly) {
        const music = activities.find(a => isMusic(a, spotifyOnly));
        split = { spotifyOnly, music, others: music ? activities.filter(a => a !== music) : activities };
        splitCache.set(activities, split);
    }
    return split;
}

function formatSong(activity: Activity) {
    const title = activity.details?.trim() || null;
    // Spotify separates artists with "; ", Discord shows them with ", "
    const artist = activity.state?.trim().split("; ").join(", ") || null;

    if (settings.store.format === "title") return title ?? artist ?? activity.name;
    return [title, artist].filter(Boolean).join(" — ") || activity.name;
}

// Same rule as Discord: in small rows, a custom status with text hides the text of the activities, only their icon stays
function hasCustomStatusText(activities: Activity[]) {
    const status = activities.find(a => a.type === ActivityType.CUSTOM_STATUS);
    return status?.state != null && (status.state.trim() !== "" || status.emoji != null);
}

// Discord's activity row renders a LISTENING activity with the music icon and its name as text
function toDisplayActivity(text: string) {
    return { type: ActivityType.LISTENING, name: text, flags: 0 };
}

function SongRow({ music, hideTooltip, ActivityRow }: { music: MusicInfo; hideTooltip: boolean; ActivityRow: ComponentType<any>; }) {
    const activity = React.useMemo(() => toDisplayActivity(music.text), [music.text]);

    return (
        <div className={cl("song", music.hideText && "icon-only")}>
            <ActivityRow
                activity={activity}
                textVariant={`text-${music.textSize}/medium`}
                textClassName={music.textClassName}
                iconClassName={music.iconClassName}
                hideText={music.hideText}
                hideTooltip={hideTooltip}
            />
        </div>
    );
}

const SafeSongRow = ErrorBoundary.wrap(SongRow, { noop: true });

export default definePlugin({
    name: "MusicInList",
    description: "⚠️ May be outdated for the current Discord. Always shows the song a friend is listening to in the friends list and Active Now, even when they are playing a game or using an app",
    tags: ["Activity", "Friends"],
    authors: [{ name: "TheUnknownMurda", id: 338163169782398977n }],
    settings,

    // Called on every render of Discord's ActivityStatus, so it must stay cheap and never throw
    getMusic(props: ActivityStatusProps): MusicInfo | null {
        try {
            const { vcMusicLocation, activities, user } = props;
            if (vcMusicLocation == null || !activities?.length || user?.bot) return null;
            if (!settings.store[locationSettings[vcMusicLocation]]) return null;

            const { music, others } = splitActivities(activities, settings.store.spotifyOnly);
            if (music == null) return null;

            const textSize = props.textSize ?? "xs";
            return {
                others,
                text: formatSong(music),
                textSize,
                textClassName: props.textClassName,
                iconClassName: props.iconClassName,
                hideText: textSize === "xs" && hasCustomStatusText(activities),
                hideTooltip: props.hideTooltip === true
            };
        } catch {
            return null;
        }
    },

    // Replaces the function rendering the main activity: the song goes right after it, before "+N"
    renderWithMusic(music: MusicInfo | null, primary: ReactNode, insideTooltip: unknown, ActivityRow: ComponentType<any>) {
        if (music == null) return primary;

        return (
            <>
                {primary}
                <SafeSongRow music={music} hideTooltip={insideTooltip === true || music.hideTooltip} ActivityRow={ActivityRow} />
            </>
        );
    },

    // Row for the tooltip listing every activity, shown when there are several besides the song
    renderTooltipSong(music: MusicInfo, rowProps: object, ActivityRow: ComponentType<any>) {
        return <ActivityRow key="vc-music-in-list" activity={toDisplayActivity(music.text)} {...rowProps} />;
    },

    // Active Now cards only render one activity per person. Adds the songs of the card's members,
    // so Discord renders them with its own Spotify (or rich presence) section after the game
    withMusicSections(entries: NowPlayingEntry[], party?: { partiedMembers?: User[]; }) {
        try {
            if (!settings.store.activeNow || !Array.isArray(entries) || !party?.partiedMembers?.length) return entries;

            const added: NowPlayingEntry[] = [];
            for (const user of party.partiedMembers) {
                if (user.bot) continue;

                const { music } = splitActivities(PresenceStore.getActivities(user.id), settings.store.spotifyOnly);
                if (music == null) continue;

                // Friends listening along on Spotify share the party id of the person they listen to
                const partyId = music.party?.id;
                const isSameSong = (a: Activity | null) => a === music || (partyId != null && a?.party?.id === partyId);
                if (entries.some(e => isSameSong(e.activity))) continue;

                const listeningAlong = added.find(e => isSameSong(e.activity));
                if (listeningAlong) {
                    listeningAlong.playingMembers.push(user);
                    continue;
                }

                added.push({
                    // Discord keys the section with the session id, which the game may share: without it, the index is used
                    activity: { ...music, session_id: undefined },
                    application: null,
                    activityUser: user,
                    playingMembers: [user],
                    startedPlayingTime: music.timestamps?.start ?? music.created_at
                });
            }

            return added.length ? [...entries, ...added] : entries;
        } catch {
            return entries;
        }
    },

    patches: [
        {
            find: '"ActivityStatus"',
            // The replacements use the variable declared by the first one
            group: true,
            replacement: [
                {
                    // Take the song out of the activities Discord displays, so it isn't hidden in "+N"
                    match: /let\{user:\i,activities:(\i),applicationStream:\i,voiceChannel:\i,.{0,300}?\}=(\i);/,
                    replace: "$&let vcMusicInList=$self.getMusic($2);null!=vcMusicInList&&($1=vcMusicInList.others);"
                },
                {
                    // Wrap the function rendering the main activity (game, stream or voice channel) to add the song after it
                    match: /function (\i)\(\)\{(?=let \i=arguments\.length>0&&void 0!==arguments\[0\]&&arguments\[0\],.{0,600}?\(0,\i\.jsx\)\((\i\.\i),\{activity:)/,
                    replace: "function $1(){return $self.renderWithMusic(vcMusicInList,$1_vcMusicInList(...arguments),arguments[0],$2)}function $1_vcMusicInList(){"
                },
                {
                    // Still render when the song is the only activity left
                    match: /(function \i\(\)\{if\(0===\i)\)return null;/,
                    replace: "$1&&null==vcMusicInList)return null;"
                },
                {
                    // Keep the dot between the activities and the custom status when the song is the only activity
                    match: /(\i)>0(?=&&\(0,\i\.jsx\)\(\i,\{textVariant:`text-\$\{\i\}\/normal`)/g,
                    replace: "($1>0||null!=vcMusicInList)"
                }
            ]
        },
        {
            find: '"ActivityStatus"',
            replacement: {
                // Add the song to the tooltip listing all activities. Guarded in case the patch group above failed
                match: /(\i)\.forEach\(\((\i),(\i)\)=>\{(\i)\.push\(\(0,\i\.jsx\)\((\i\.\i),\{activity:\2,\.\.\.(\i)\},`activity-\$\{\3\}`\)\)\}\)/,
                replace: '$&,"undefined"!=typeof vcMusicInList&&null!=vcMusicInList&&$4.push($self.renderTooltipSong(vcMusicInList,$6,$5))'
            }
        },
        {
            // Friends list
            find: "null!=this.peopleListItemRef.current",
            replacement: {
                match: /activities:\i,applicationStream:\i,voiceChannel:\i,animateEmoji:/,
                replace: 'vcMusicLocation:"friends",$&'
            }
        },
        {
            // Direct messages list
            find: "PrivateChannel.renderAvatar",
            replacement: {
                match: /user:\i,activities:\i,voiceChannel:\i,applicationStream:\i,animateEmoji:/,
                replace: 'vcMusicLocation:"dms",$&'
            }
        },
        {
            // Server member list, same find as Vencord's MemberListDecoratorsAPI
            find: "#{intl::GUILD_OWNER}),children:",
            replacement: {
                // Stops at animateEmoji: AlwaysAnimate replaces its value
                match: /user:\i,activities:\i,applicationStream:\i,voiceChannel:\i,animateEmoji:/,
                replace: 'vcMusicLocation:"members",$&'
            }
        },
        {
            // Active Now card body, which renders a section for each item of the card's currentActivities
            find: ".SpotifySection,{",
            replacement: {
                match: /(\i)(\.forEach\(\((\i),\i\)=>\{let\{activity:\i,application:\i,playingMembers:\i,activityUser:\i\}=\3;)/,
                replace: "$self.withMusicSections($1,arguments[0]?.party)$2"
            }
        }
    ]
});
