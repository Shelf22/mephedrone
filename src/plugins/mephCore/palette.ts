/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Discord builds every colour from primitive ramps declared on :root as "-hsl" triplets,
// e.g. --neutral-69-hsl: 231 calc(var(--saturation-factor, 1)*6.5%) 21%;  --blurple-50-hsl: …
// Semantic tokens (--background-base-low, --text-brand, …) point at these ramps, so remapping the
// ramps re-colours the whole client while keeping Discord's own contrast relationships intact.

export interface Hsl { h: number; s: number; l: number; }

export interface NeutralRamp {
    h: number;
    s: number;
    /** multiplies lightness of the dark half (backgrounds); <1 = darker */
    darkScale: number;
    /** added to lightness of the dark half after scaling */
    darkLift: number;
}

const RAMP_RE = /^--(neutral|blurple|opacity-blurple|brand)-[\w-]*?-hsl$/;
const HSL_RE = /^\s*([\d.]+)\s+(?:calc\([^*]*\*\s*)?([\d.]+)%\)?\s+([\d.]+)%/;

let originals: Map<string, Hsl> | null = null;

/** Reads Discord's untouched ramp values from its own stylesheets (cached; ignores our injected styles). */
export function readRamps(): Map<string, Hsl> {
    if (originals?.size) return originals;
    const found = new Map<string, Hsl>();
    for (const sheet of Array.from(document.styleSheets)) {
        if (!sheet.href?.includes("/assets/")) continue;
        let rules: CSSRuleList;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of Array.from(rules)) {
            if (!(rule instanceof CSSStyleRule) || rule.selectorText !== ":root") continue;
            for (const prop of Array.from(rule.style)) {
                if (!RAMP_RE.test(prop) || found.has(prop)) continue;
                const m = HSL_RE.exec(rule.style.getPropertyValue(prop));
                if (m) found.set(prop, { h: +m[1], s: +m[2], l: +m[3] });
            }
        }
    }
    if (found.size) originals = found;
    return found;
}

export function hexToHsl(hex: string): Hsl {
    const n = parseInt(hex.replace("#", ""), 16);
    const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (d) {
        s = d / (1 - Math.abs(2 * l - 1));
        h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        h = (h * 60 + 360) % 360;
    }
    return { h, s: s * 100, l: l * 100 };
}

const f = (n: number) => +n.toFixed(2);
const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

/** CSS for :root that re-colours the neutral ramp (greys) and/or the accent ramps. */
export function buildRampCss(neutral: NeutralRamp | null, accentHex: string | null) {
    const ramps = readRamps();
    const base = ramps.get("--blurple-50-hsl");
    const accent = accentHex ? hexToHsl(accentHex) : null;
    const lines: string[] = [];

    for (const [prop, o] of ramps) {
        if (prop.startsWith("--neutral-")) {
            if (!neutral) continue;
            const l = o.l < 50 ? clamp(o.l * neutral.darkScale + neutral.darkLift) : o.l;
            lines.push(`${prop}: ${f(neutral.h)} ${f(neutral.s)}% ${f(l)}%;`);
        } else if (accent && base) {
            // keep each shade's lightness, take hue + saturation from the accent
            const s = clamp(accent.s * (o.s / (base.s || 1)));
            lines.push(`${prop}: ${f(accent.h)} ${f(s)}% ${f(o.l)}%;`);
        }
    }
    return lines.length ? `:root {\n${lines.join("\n")}\n}` : "";
}
