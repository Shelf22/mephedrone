/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const TINY = { a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ", n: "ⁿ", o: "ᵒ", p: "ᵖ",
    q: "q", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ" };
const tools = {
    mock: ["sPoNgEbOb text", t => [...t].map((c, i) => i % 2 ? c.toUpperCase() : c.toLowerCase()).join("")],
    reverse: ["Write text backwards", t => [...t].reverse().join("")],
    clap: ["Put 👏 between 👏 words", t => t.trim().split(/\s+/).join(" 👏 ")],
    tiny: ["ˢᵐᵃˡˡ text", t => [...t.toLowerCase()].map(c => TINY[c] ?? c).join("")],
    wide: ["Ｗｉｄｅ text", t => [...t].map(c => c === " " ? "　" : c >= "!" && c <= "~" ? String.fromCharCode(c.charCodeAt(0) + 0xFEE0) : c).join("")],
};
for (const [name, [description, fn]] of Object.entries(tools)) {
    meph.commands.register({ name, description, options: [{ name: "text", description: "Your text", type: "string", required: true }] },
        ({ text }) => ({ send: fn(String(text)).slice(0, 2000) }));
}
