/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

let words = [];
async function load() {
    const { keywords } = await meph.settings.get();
    words = String(keywords || "").split(",").map(w => w.trim().toLowerCase()).filter(Boolean);
}
load();
meph.on("settings", load);

meph.on("message", m => {
    if (m.fromMe || !words.length) return;
    const text = m.content.toLowerCase();
    const hit = words.find(w => new RegExp(`(^|\\W)${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\W)`).test(text));
    if (hit) meph.ui.toast(`🔔 "${hit}" from ${m.author.username}: ${m.content.slice(0, 80)}`);
});
