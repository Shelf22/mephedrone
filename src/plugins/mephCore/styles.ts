/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NeutralRamp } from "./palette";

/** Selector for Discord's hashed class names, e.g. c("sidebar") matches class="sidebar_a1b2c3 …" */
export const c = (name: string) => `[class^="${name}_"],[class*=" ${name}_"]`;
const each = (names: string[], rule: string) => names.map(n => c(n)).join(",") + `{${rule}}`;

export const FONTS = {
    discord: { label: "gg sans (Discord)", family: "\"gg sans\",\"Noto Sans\",sans-serif" },
    jetbrains: { label: "JetBrains Mono", family: "\"JetBrainsMono Nerd Font\",\"JetBrains Mono\",\"Hack\",monospace" },
    hack: { label: "Hack", family: "\"Hack\",\"JetBrainsMono Nerd Font\",monospace" },
    system: { label: "System sans", family: "system-ui,\"Noto Sans\",sans-serif" },
} as const;
export type FontId = keyof typeof FONTS;

export const CORNERS = { square: 0, soft: 0.5, rounded: 1, round: 1.6 } as const;
export type CornerId = keyof typeof CORNERS;

export interface MephStyle {
    id: string;
    name: string;
    tagline: string;
    neutral: NeutralRamp | null;
    accent: string | null;
    font: FontId;
    corners: CornerId;
    messages: "bubbles" | "terminal" | "classic";
    islands: boolean;
    floatComposer: boolean;
    /** swatches for the picker preview: background, panel, text, accent */
    preview: [string, string, string, string];
    /** extra CSS, scoped by html[data-meph-style] at injection time */
    css: (effects: boolean) => string;
    /** CSS built from the live, already-recoloured tokens (read after the palette is applied) */
    tokens?: (get: (name: string) => string, effects: boolean) => string;
}

const PANELS = ["guilds", "sidebarList", "panels", "page", "membersWrap", "searchBar"];

export const STYLES: MephStyle[] = [
    {
        id: "terminal",
        name: "Terminal",
        tagline: "Monospace, hard edges, scanlines. Feels like a hacker tool.",
        neutral: { h: 150, s: 10, darkScale: 0.62, darkLift: 0 },
        accent: "#3dff8a",
        font: "jetbrains",
        corners: "square",
        messages: "terminal",
        islands: false,
        floatComposer: false,
        preview: ["#060a08", "#0c120f", "#cfe9da", "#3dff8a"],
        css: fx => `
            ${each(PANELS, "box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--meph-accent) 18%, transparent) !important;")}
            :is(${c("headerBar")}) :is(h1, h2), :is(${c("bar")}) :is(${c("title")}) { text-transform: uppercase; letter-spacing: .08em; }
            :is(${c("bar")}) > :is(${c("title")})::before { content: "[ "; color: var(--meph-accent); }
            :is(${c("bar")}) > :is(${c("title")})::after { content: " ]"; color: var(--meph-accent); }
            ::selection { background: var(--meph-accent); color: #000; }
            textarea, [contenteditable="true"] { caret-color: var(--meph-accent); }
            a, ${c("anchor")} { text-decoration-style: dotted; }
            ${fx ? `
            body::after { content: ""; position: fixed; inset: 0; z-index: 2147483000; pointer-events: none;
                background: repeating-linear-gradient(0deg, rgb(0 0 0 / 22%) 0 1px, transparent 1px 3px); }
            :is(${c("mention")}) { text-shadow: 0 0 6px color-mix(in srgb, var(--meph-accent) 60%, transparent); }
            ` : ""}
        `,
    },
    {
        id: "glass",
        name: "Glass",
        tagline: "Frosted see-through panels over a glowing background.",
        neutral: { h: 255, s: 28, darkScale: 0.9, darkLift: 1 },
        accent: "#c77dff",
        font: "discord",
        corners: "round",
        messages: "bubbles",
        islands: true,
        floatComposer: true,
        preview: ["#120e24", "#1d1838", "#ece8ff", "#c77dff"],
        tokens: (get, fx) => {
            // inside the main window only (modals/popouts live outside base_ and stay solid)
            const glass: [string, number][] = [
                ["--background-base-lowest", 30], ["--background-base-lower", 38], ["--background-base-low", 44],
                ["--background-surface-high", 50], ["--background-surface-higher", 56], ["--background-surface-highest", 62],
                ["--chat-background-default", 30], ["--background-secondary-alt", 50], ["--card-background-default", 45],
                ["--channeltextarea-background", 55], ["--app-frame-background", 0], ["--bg-base-primary", 35],
                ["--bg-base-secondary", 40], ["--bg-base-tertiary", 30],
            ];
            const k = fx ? 1 : 1.6;
            const vars = glass.map(([n, pct]) => {
                const v = get(n);
                return v ? `${n}: color-mix(in oklab, ${v} ${Math.min(100, pct * k)}%, transparent);` : "";
            }).join("\n");
            return `:is(${c("base")}) {\n${vars}\n}`;
        },
        css: fx => `
            ${c("bg")} {
                background:
                    radial-gradient(60% 70% at 12% 18%, color-mix(in srgb, var(--meph-accent) 45%, transparent), transparent 70%),
                    radial-gradient(55% 60% at 88% 82%, color-mix(in srgb, var(--meph-accent2) 40%, transparent), transparent 70%),
                    radial-gradient(40% 50% at 70% 10%, color-mix(in srgb, var(--meph-accent) 20%, transparent), transparent 70%),
                    hsl(var(--neutral-90-hsl, 250 30% 6%)) !important;
            }
            ${each(PANELS, `${fx ? "backdrop-filter: blur(24px) saturate(160%);" : ""}
                box-shadow: inset 0 0 0 1px rgb(255 255 255 / 9%), 0 10px 40px rgb(0 0 0 / 30%) !important;`)}
            ::selection { background: color-mix(in srgb, var(--meph-accent) 45%, transparent); }
            ${fx ? `:is(${c("mention")}) { box-shadow: 0 0 18px -4px var(--meph-accent); }` : ""}
        `,
    },
    {
        id: "minimal",
        name: "Minimal",
        tagline: "Quiet greys, thin lines, no clutter.",
        neutral: { h: 0, s: 0, darkScale: 0.92, darkLift: 1.5 },
        accent: "#7aa2ff",
        font: "system",
        corners: "soft",
        messages: "bubbles",
        islands: true,
        floatComposer: true,
        preview: ["#141414", "#1c1c1c", "#e6e6e6", "#7aa2ff"],
        css: () => `
            a[href="/shop"], a[href="/quest-home"], a[href="/store"], [aria-label="Send a gift"], [aria-label="Help"],
            ${c("nowPlayingColumn")} { display: none !important; }
            ${each(PANELS, "box-shadow: none !important;")}
            ${c("guilds")}, ${c("sidebarList")} { border-right: 1px solid var(--border-subtle) !important; }
            h1, h2, h3 { font-weight: 600 !important; }
            ::selection { background: color-mix(in srgb, var(--meph-accent) 35%, transparent); }
        `,
    },
    {
        id: "classic",
        name: "Classic",
        tagline: "Discord's own look, with your accent and font if you pick one.",
        neutral: null,
        accent: null,
        font: "discord",
        corners: "rounded",
        messages: "classic",
        islands: false,
        floatComposer: false,
        preview: ["#1a1a1e", "#232328", "#dbdee1", "#5865f2"],
        css: () => "",
    },
];

export const ACCENT_PRESETS = ["#3dff8a", "#9fe8ff", "#c77dff", "#ff4fd8", "#ff3348", "#ffc94a", "#7aa2ff", "#f2f2f2"];

export const getStyle = (id: string) => STYLES.find(s => s.id === id) ?? STYLES[0];
