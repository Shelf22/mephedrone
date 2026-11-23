/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Swaps Discord's logo for ours everywhere it appears: every copy of the Clyde icon, the tab icon and the window title.

import { BRAND, BRAND_LOGO, BRAND_MASK } from "@shared/brand";

// Discord's logo is one SVG path reused everywhere (home button, invites, embeds, menus…)
const CLYDE = 'path[d^="M19.73 4.87"]';

// the logo + "Discord" wordmark on the login/register pages is a plain image
const WORDMARK = "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="178" height="26" viewBox="0 0 178 26">`
    + `<image href="${BRAND_LOGO}" x="0" y="1" width="24" height="24"/>`
    + `<text x="32" y="19" fill="#fff" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="15" font-weight="800" letter-spacing="1">${BRAND}</text></svg>`);

export const brandingCss = `
svg:has(> ${CLYDE}), svg:has(> g > ${CLYDE}) {
    background-color: currentColor;
    -webkit-mask: url("${BRAND_MASK}") center / 86% no-repeat;
    mask: url("${BRAND_MASK}") center / 86% no-repeat;
}
svg > ${CLYDE}, svg > g > ${CLYDE} { visibility: hidden; }
img[class*="logoWithText_"] { content: url("${WORDMARK}"); width: 178px; height: 26px; }
`;

let obs: MutationObserver | null = null;

function fixHead() {
    for (const l of document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')) {
        if (l.href !== BRAND_LOGO) l.href = BRAND_LOGO;
    }
    if (!document.querySelector('link[rel~="icon"]')) {
        const l = document.createElement("link");
        l.rel = "icon";
        l.href = BRAND_LOGO;
        document.head.appendChild(l);
    }
    const t = document.title;
    const nt = t.replace(/^Discord\b/, BRAND).replace(/\bDiscord$/, BRAND).replace(/^\(\d+\)\s*Discord\b/, m => m.replace("Discord", BRAND));
    if (nt !== t) document.title = nt;
}

export function startBranding() {
    fixHead();
    obs = new MutationObserver(fixHead);
    obs.observe(document.head, { subtree: true, childList: true, attributes: true, characterData: true, attributeFilter: ["href"] });
}

export function stopBranding() {
    obs?.disconnect();
    obs = null;
}
