/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import { classes } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findComponentByCodeLazy, findStoreLazy } from "@webpack";
import { Menu, Popout, showToast, useRef, useState, useStateFromStores } from "@webpack/common";

import managedStyle from "./style.css?managed";

const logger = new Logger("SpotifyActivityToggle");

interface ConnectedAccount {
    id: string;
    type: string;
    revoked: boolean;
    showActivity: boolean;
}

// Stores and Discord modules are found lazily: they don't exist yet when this file loads
const ConnectedAccountsStore = findStoreLazy("ConnectedAccountsStore");
const LocalActivityStore = findStoreLazy("LocalActivityStore");
// Same module Discord uses for the "Display Spotify as your status" switch in Connections
const ConnectedAccountActions = findByPropsLazy("setShowActivity");
// Discord's button for the mic / headset row (the one GameActivityToggle uses)
const PanelButton = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");
// The setting GameActivityToggle's gamepad turns on and off (game and app activity, not Spotify)
const ShowCurrentGame = getUserSettingLazy<boolean>("status", "showCurrentGame")!;

const settings = definePluginSettings({
    showToast: {
        type: OptionType.BOOLEAN,
        description: "Show a small message when the Spotify status is turned on or off",
        default: true
    },
    hideWithoutSpotify: {
        type: OptionType.BOOLEAN,
        description: "Hide the button when no Spotify account is connected to Discord",
        default: false
    }
});

function getSpotifyAccounts(): ConnectedAccount[] {
    const accounts: ConnectedAccount[] = ConnectedAccountsStore.getAccounts() ?? [];
    return accounts.filter(a => a.type === "spotify" && !a.revoked);
}

const SPOTIFY_PATH = "M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.52 17.34c-.24.36-.66.48-1.02.24-2.82-1.74-6.36-2.1-10.56-1.14-.42.12-.78-.18-.9-.54-.12-.42.18-.78.54-.9 4.56-1.02 8.52-.6 11.64 1.32.42.18.48.66.3 1.02zm1.44-3.3c-.3.42-.84.6-1.26.3-3.24-1.98-8.16-2.58-11.94-1.38-.48.12-1.02-.12-1.14-.6-.12-.48.12-1.02.6-1.14C9.6 9.9 15 10.56 18.72 12.84c.36.18.54.78.24 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.3c-.6.18-1.2-.18-1.38-.72-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.62.54.3.72 1.02.42 1.56-.3.42-1.02.6-1.56.3z";

function SpotifyIcon({ enabled }: { enabled: boolean; }) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24">
            <path
                fill={enabled ? "currentColor" : "var(--status-danger)"}
                mask={enabled ? void 0 : "url(#vc-spotifyActivityMask)"}
                d={SPOTIFY_PATH}
            />
            {!enabled && <>
                <path fill="var(--status-danger)" d="M22.7 2.7a1 1 0 0 0-1.4-1.4l-20 20a1 1 0 1 0 1.4 1.4Z" />
                <mask id="vc-spotifyActivityMask">
                    <rect fill="white" x="0" y="0" width="24" height="24" />
                    <path fill="black" d="M23.27 4.73 19.27 .73 -.27 20.27 3.73 24.27Z" />
                </mask>
            </>}
        </svg>
    );
}

async function setShowSpotify(accounts: ConnectedAccount[], show: boolean) {
    await Promise.all(accounts.map(a => ConnectedAccountActions.setShowActivity(a.type, a.id, show)));

    // Discord only recalculates your status on the next Spotify update (a few seconds later).
    // Your status is rebuilt whenever the local activity store changes, so this applies it right away.
    try {
        LocalActivityStore.emitChange();
    } catch (e) {
        logger.warn("Could not refresh the Spotify status right away", e);
    }
}

// Shared by the Spotify button and the dropdown menu
function useSpotifyToggle() {
    // Booleans instead of the account list: Discord edits the accounts in place,
    // so comparing the list would never notice the change
    const hasSpotify = useStateFromStores([ConnectedAccountsStore], () => getSpotifyAccounts().length > 0);
    const storeEnabled = useStateFromStores([ConnectedAccountsStore], () => getSpotifyAccounts().some(a => a.showActivity));

    // The change is a request to Discord's servers: show the new state at once, without waiting for it
    const [pending, setPending] = useState<boolean | null>(null);
    const enabled = pending ?? storeEnabled;

    const toggle = async () => {
        const accounts = getSpotifyAccounts();
        if (!accounts.length) {
            showToast("No Spotify account is connected to Discord (User Settings > Connections)", "failure");
            return;
        }

        const next = !enabled;
        setPending(next);
        try {
            await setShowSpotify(accounts, next);
            if (settings.store.showToast)
                showToast(next ? "Spotify is shown on your profile" : "Spotify is hidden from your profile", "success");
        } catch (e) {
            logger.error("Could not change the Spotify status", e);
            showToast("Could not change the Spotify status, try again", "failure");
        } finally {
            setPending(null);
        }
    };

    return { hasSpotify, enabled, toggle };
}

// Used when GameActivityToggle is off: a full Spotify button
function SpotifyButton({ nameplate }: { nameplate?: any; }) {
    const { hideWithoutSpotify } = settings.use(["hideWithoutSpotify"]);
    const { hasSpotify, enabled, toggle } = useSpotifyToggle();

    if (!hasSpotify && hideWithoutSpotify) return null;

    return (
        <PanelButton
            tooltipText={!hasSpotify
                ? "No Spotify account connected"
                : enabled ? "Hide Spotify listening" : "Show Spotify listening"}
            icon={() => <SpotifyIcon enabled={enabled && hasSpotify} />}
            role="switch"
            ariaChecked={enabled}
            redGlow={hasSpotify && !enabled}
            plated={nameplate != null}
            onClick={toggle}
        />
    );
}

// Used when GameActivityToggle is on: a small arrow next to the gamepad, like the mic's,
// whose menu turns off the music or the game activity separately
function ActivityDropdown() {
    const { hideWithoutSpotify } = settings.use(["hideWithoutSpotify"]);
    const { hasSpotify, enabled, toggle } = useSpotifyToggle();
    const showCurrentGame = ShowCurrentGame.useSetting();
    const buttonRef = useRef<HTMLButtonElement | null>(null);

    if (!hasSpotify && hideWithoutSpotify) return null;

    return (
        <Popout
            position="top"
            align="center"
            targetElementRef={buttonRef}
            renderPopout={({ closePopout }) => (
                <Menu.Menu navId="vc-spotifyActivityToggle-menu" onClose={closePopout}>
                    <Menu.MenuCheckboxItem
                        id="vc-spotifyActivityToggle-music"
                        label={hasSpotify ? "Show Spotify music" : "Show Spotify music (no account connected)"}
                        checked={hasSpotify && enabled}
                        disabled={!hasSpotify}
                        action={toggle}
                    />
                    <Menu.MenuCheckboxItem
                        id="vc-spotifyActivityToggle-activity"
                        label="Show game activity"
                        checked={showCurrentGame}
                        action={() => ShowCurrentGame.updateSetting(old => !old)}
                    />
                </Menu.Menu>
            )}
        >
            {popoutProps => (
                <button
                    ref={buttonRef}
                    onClick={popoutProps.onClick}
                    className={classes("vc-spotifyActivityToggle-arrow", hasSpotify && !enabled && "vc-spotifyActivityToggle-arrowOff")}
                    aria-label="Activity options"
                    title={hasSpotify && !enabled ? "Spotify music is hidden" : "Activity options"}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24">
                        <path fill="currentColor" d="M5.3 9.3a1 1 0 0 1 1.4 0l5.3 5.29 5.3-5.3a1 1 0 1 1 1.4 1.42l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.42Z" />
                    </svg>
                </button>
            )}
        </Popout>
    );
}

function SpotifyActivityToggleButton(props: { nameplate?: any; }) {
    return isPluginEnabled("GameActivityToggle")
        ? <ActivityDropdown />
        : <SpotifyButton nameplate={props?.nameplate} />;
}

export default definePlugin({
    name: "SpotifyActivityToggle",
    description: "Adds a button next to the mic and deafen buttons to show or hide your Spotify listening status. With GameActivityToggle on, it becomes a small arrow next to the gamepad to hide only the music.",
    tags: ["Activity", "Shortcuts"],
    authors: [{ name: "TheUnknownMurda", id: 338163169782398977n }],
    dependencies: ["UserSettingsAPI"],
    settings,

    managedStyle,

    patches: [
        {
            // Account panel at the bottom left (avatar, mic, headset, settings)
            find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
            replacement: {
                // Puts the button right before the mic button, so after GameActivityToggle's gamepad.
                // Doesn't use "children:[" like GameActivityToggle does, so both plugins can be on together.
                match: /(?=\(0,\i\.jsxs?\)\(\i,\{accountContainerRef:)/,
                replace: "$self.SpotifyActivityToggleButton(arguments[0]),"
            }
        }
    ],

    SpotifyActivityToggleButton: ErrorBoundary.wrap(SpotifyActivityToggleButton, { noop: true }),
});
