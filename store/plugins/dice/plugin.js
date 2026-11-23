/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

meph.commands.register({
    name: "roll",
    description: "Roll dice, e.g. 2d6, d20 or 3d8+2",
    options: [{ name: "dice", description: "Dice to roll (default d6)", type: "string" }],
}, ({ dice = "d6" }) => {
    const m = /^(\d*)d(\d+)([+-]\d+)?$/i.exec(String(dice).replace(/\s/g, ""));
    if (!m) return { reply: "Use dice like 2d6, d20 or 3d8+2" };
    const n = Math.min(Number(m[1]) || 1, 50), sides = Math.min(Number(m[2]), 1000), mod = Number(m[3] || 0);
    if (sides < 2) return { reply: "Dice need at least 2 sides" };
    const rolls = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * sides));
    const total = rolls.reduce((a, b) => a + b, 0) + mod;
    return { send: `🎲 ${dice}: ${rolls.join(" + ")}${mod ? ` (${m[3]})` : ""} = **${total}**` };
});

meph.commands.register({ name: "flip", description: "Flip a coin" },
    () => ({ send: `🪙 ${Math.random() < 0.5 ? "Heads" : "Tails"}` }));
