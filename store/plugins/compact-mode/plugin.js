/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const S = { light: [0.85, 44], medium: [0.7, 40], max: [0.5, 34] };
async function apply() {
    const { strength } = await meph.settings.get();
    const [k, icon] = S[strength] ?? S.medium;
    meph.ui.css(`
        [class^="message_"], [class*=" message_"] { padding-top: calc(2px * ${k}) !important; padding-bottom: calc(2px * ${k}) !important; }
        [class*="groupStart_"] { margin-top: calc(17px * ${k}) !important; }
        [data-list-item-id^="guildsnav___"] [class*="wrapper_"] { width: ${icon}px !important; height: ${icon}px !important; }
        [data-list-item-id^="channels___"] { padding-top: 0 !important; padding-bottom: 0 !important; }
        [class*="containerDefault_"] { padding-top: 0 !important; }
    `);
}
apply();
meph.on("settings", apply);
