/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { managedStyleRootNode } from "@api/Styles";
import { createAndAppendStyle } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, SelectedChannelStore, StreamerModeStore } from "@webpack/common";

let styleElement: HTMLStyleElement | null = null;
const STYLE_ID = "vencord-blur-streamer";

/** Set on <html> while the blur should be applied at all (respects onlyInStreamerMode) */
const ACTIVE_CLASS = "vc-bs-active";
/** Set on <html> while the currently selected channel is a DM or group DM */
const DM_CLASS = "vc-bs-in-dm";

const settings = definePluginSettings({
    blurDMList: {
        type: OptionType.BOOLEAN,
        description: "Blur the Direct Messages list in the left sidebar",
        default: true,
        onChange: updateStyles
    },
    blurMessages: {
        type: OptionType.BOOLEAN,
        description: "Blur messages in conversations",
        default: true,
        onChange: updateStyles
    },
    blurSenders: {
        type: OptionType.BOOLEAN,
        description: "Blur message senders (usernames and avatars)",
        default: true,
        onChange: updateStyles
    },
    blurContent: {
        type: OptionType.BOOLEAN,
        description: "Blur message contents (text, attachments, images, embeds)",
        default: true,
        onChange: updateStyles
    },
    blurTimestamps: {
        type: OptionType.BOOLEAN,
        description: "Blur message timestamps (dates and times)",
        default: true,
        onChange: updateStyles
    },
    blurDMHeader: {
        type: OptionType.BOOLEAN,
        description: "Blur Direct Message header (recipient name at the top)",
        default: true,
        onChange: updateStyles
    },
    revealOnHover: {
        type: OptionType.BOOLEAN,
        description: "Reveal blurred elements on mouse hover",
        default: true,
        onChange: updateStyles
    },
    onlyInDMs: {
        type: OptionType.BOOLEAN,
        description: "Only blur messages in Direct Messages (if disabled, also blurs on servers)",
        default: false,
        onChange: updateStyles
    },
    onlyInStreamerMode: {
        type: OptionType.BOOLEAN,
        description: "Only activate blur when Discord's Streamer Mode is enabled",
        default: false,
        onChange: updateState
    },
    blurAmount: {
        type: OptionType.SLIDER,
        description: "Blur intensity (in pixels). Below ~6px, text stays readable on a stream recording",
        markers: [1, 2, 4, 6, 8, 12, 16, 24],
        default: 2,
        stickToMarkers: false,
        onChange: updateStyles
    }
});

function isCurrentChannelDM(): boolean {
    const channelId = SelectedChannelStore.getChannelId();
    const channel = channelId ? ChannelStore.getChannel(channelId) : null;

    // isPrivate() covers both DMs and group DMs. Fall back to the route for the
    // DM home page and the brief window before a channel is selected.
    return channel?.isPrivate() ?? location.pathname.startsWith("/channels/@me");
}

function isBlurActive(): boolean {
    return !settings.store.onlyInStreamerMode || StreamerModeStore.enabled;
}

function updateState() {
    const { classList } = document.documentElement;

    classList.toggle(DM_CLASS, isCurrentChannelDM());
    classList.toggle(ACTIVE_CLASS, isBlurActive());
}

/** Message rows. Deliberately narrow: `[class*="message"]` also matches search results, popouts and forum previews. */
const MESSAGE_ROOTS = [
    'li[id^="chat-messages-"]',
    '[class*="messageListItem"]'
];

/** Avatars nest (wrapper + <img>), so only match the outermost one, otherwise the blur compounds. */
const OUTERMOST_AVATAR = '[class*="avatar"]:not([class*="avatar"] *)';

const SENDER_PARTS = [
    OUTERMOST_AVATAR,
    '[class*="username"]',
    '[class*="repliedMessage"] [class*="repliedTextPreview"]',
    '[class*="repliedMessage"] [class*="repliedTextContent"]'
];

const CONTENT_PARTS = ['[class*="messageContent"]'];

const MEDIA_PARTS = [
    '[class*="imageWrapper"]',
    '[class*="embedWrapper"]',
    '[class*="attachment"]',
    '[class*="mediaAttachmentsContainer"]'
];

const TIMESTAMP_PARTS = [
    '[class*="timestamp"]',
    "time"
];

const DM_ROWS = [
    'li:has(a[href*="/channels/@me/"])',
    'a[href*="/channels/@me/"]'
];

const DM_PARTS = [
    OUTERMOST_AVATAR,
    'img:not([class*="avatar"] *)',
    '[class*="name"]',
    '[class*="channelName"]',
    '[class*="subText"]',
    '[class*="subtext"]',
    '[class*="activity"]'
];

const DM_HEADER_SELECTORS = [
    'section[class*="title"] [class*="title"]',
    'section[class*="title"] [class*="children"] [class*="title"]',
    '[class*="chat"] > [class*="title"] [class*="title"]'
];

const cross = (roots: string[], parts: string[], prefix: string, rootSuffix = "") =>
    roots.flatMap(root => parts.map(part => `${prefix}${root}${rootSuffix} ${part}`));

function updateStyles() {
    if (!styleElement) return;

    const {
        blurDMList,
        blurMessages,
        blurSenders,
        blurContent,
        blurTimestamps,
        blurDMHeader,
        revealOnHover,
        onlyInDMs,
        blurAmount
    } = settings.store;

    const parsedAmount = Number(blurAmount);
    const radius = Math.max(0, Number.isFinite(parsedAmount) ? parsedAmount : 2);
    const transition = "transition: filter 0.22s cubic-bezier(0.4, 0, 0.2, 1);";
    const selfReveal = revealOnHover ? "&:hover { filter: blur(0) !important; }" : "";

    // Everything is gated on <html class="vc-bs-active">, so toggling streamer mode
    // or switching channels only flips a class instead of reparsing this stylesheet.
    const root = `html.${ACTIVE_CLASS}`;
    const dmRoot = `${root}.${DM_CLASS}`;
    const messageRoot = onlyInDMs ? dmRoot : root;

    /** Blurred elements reveal on their own hover, and on hover of the row they belong to. */
    const blurRule = (selectors: string[], hoverRoots: string[], parts: string[], prefix: string, blur = "var(--vc-bs-radius)") => {
        let rule = `
        ${selectors.join(",\n        ")} {
            filter: blur(${blur}) !important;
            ${transition}
            ${selfReveal}
        }
        `;

        if (revealOnHover) {
            rule += `
        ${cross(hoverRoots, parts, prefix, ":hover").join(",\n        ")} {
            filter: blur(0) !important;
        }
        `;
        }

        return rule;
    };

    let css = `
        /* --- Blur Streamer Plugin Styles --- */
        :root {
            --vc-bs-radius: ${radius}px;
            --vc-bs-media-radius: ${radius * 1.5}px;
        }
    `;

    // 1. DM list in the left sidebar, excluding Friends / Nitro / Shop / Quests and category headers
    if (blurDMList) {
        css += `
        [class*="friendsButtonContainer"],
        [class*="friendsButtonContainer"] *,
        li:has(a[href="/channels/@me"]),
        li:has(a[href="/channels/@me"]) *,
        li:has(a[href*="/nitro"]),
        li:has(a[href*="/nitro"]) *,
        li:has(a[href*="/store"]),
        li:has(a[href*="/store"]) *,
        li:has(a[href*="/shop"]),
        li:has(a[href*="/shop"]) *,
        li:has(a[href*="/quest"]),
        li:has(a[href*="/quest"]) *,
        [class*="privateChannelsHeaderContainer"],
        [class*="privateChannelsHeaderContainer"] * {
            filter: none !important;
        }
        `;

        css += blurRule(cross(DM_ROWS, DM_PARTS, `${root} `), DM_ROWS, DM_PARTS, `${root} `);
    }

    // 2. Messages in a conversation
    if (blurMessages) {
        const prefix = `${messageRoot} `;

        if (blurSenders) {
            css += blurRule(cross(MESSAGE_ROOTS, SENDER_PARTS, prefix), MESSAGE_ROOTS, SENDER_PARTS, prefix);
        }

        if (blurContent) {
            css += blurRule(cross(MESSAGE_ROOTS, CONTENT_PARTS, prefix), MESSAGE_ROOTS, CONTENT_PARTS, prefix);
            css += blurRule(cross(MESSAGE_ROOTS, MEDIA_PARTS, prefix), MESSAGE_ROOTS, MEDIA_PARTS, prefix, "var(--vc-bs-media-radius)");
        }

        if (blurTimestamps) {
            css += blurRule(cross(MESSAGE_ROOTS, TIMESTAMP_PARTS, prefix), MESSAGE_ROOTS, TIMESTAMP_PARTS, prefix);
        }
    }

    // 3. DM header (recipient name in the top bar). Independent of blurMessages.
    if (blurDMHeader) {
        const selectors = DM_HEADER_SELECTORS.map(sel => `${dmRoot} ${sel}`);

        css += `
        ${selectors.join(",\n        ")} {
            filter: blur(var(--vc-bs-radius)) !important;
            ${transition}
            ${selfReveal}
        }
        `;

        if (revealOnHover) {
            css += `
        ${dmRoot} section[class*="title"]:hover [class*="title"] {
            filter: blur(0) !important;
        }
        `;
        }
    }

    styleElement.textContent = css;
}

export default definePlugin({
    name: "BlurStreamer",
    description: "Blurs the Direct Messages list and conversation messages (senders, content, timestamps) to protect privacy while streaming",
    authors: [{
        name: "soydex",
        id: 527482340847386625n,
    }],
    tags: ["Privacy", "Chat", "Utility"],
    settings,

    flux: {
        CHANNEL_SELECT: () => updateState(),
        // Read the value off the action: the store may not have handled it yet.
        STREAMER_MODE_UPDATE: ({ key, value }: { key: string; value: boolean; }) => {
            if (key !== "enabled") return;

            document.documentElement.classList.toggle(
                ACTIVE_CLASS,
                !settings.store.onlyInStreamerMode || value
            );
        },
        CONNECTION_OPEN: () => updateState()
    },

    start() {
        styleElement = createAndAppendStyle(STYLE_ID, managedStyleRootNode);

        updateState();
        updateStyles();

        window.addEventListener("popstate", updateState);
    },

    stop() {
        styleElement?.remove();
        styleElement = null;

        document.documentElement.classList.remove(ACTIVE_CLASS, DM_CLASS);

        window.removeEventListener("popstate", updateState);
    }
});
