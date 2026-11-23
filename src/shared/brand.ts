/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const BRAND = "[MEPHEDRONE]";
export const BRAND_PLAIN = "Mephedrone";
export const DATA_FOLDER = "Mephedrone";
// Web page that lets people on normal Discord read/reply to encrypted messages (decrypts in their browser).
// Must match where site/r.html is hosted.
export const READER_URL = "https://shelf22.github.io/mephedrone/r";

// Square logo: bracketed "M" on black, used for the settings banner and bot messages.
export const BRAND_LOGO = "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<rect width="128" height="128" rx="28" fill="#0a0a0d"/>
<path d="M30 26h-10v76h10M98 26h10v76H98" fill="none" stroke="#e9f6ff" stroke-width="7"/>
<path d="M38 92V38l26 30 26-30v54" fill="none" stroke="#9fe8ff" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>
<circle cx="96" cy="32" r="5" fill="#ffffff"/><circle cx="34" cy="98" r="3" fill="#ffffff" opacity=".7"/>
</svg>`
);

// White-on-transparent version used as a CSS mask, so it takes whatever colour Discord gives its own logo
export const BRAND_MASK = "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<path d="M30 22H14v84h16M98 22h16v84H98" fill="none" stroke="#fff" stroke-width="10"/>
<path d="M38 94V36l26 32 26-32v58" fill="none" stroke="#fff" stroke-width="13" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`
);
