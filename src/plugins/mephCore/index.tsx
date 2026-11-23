/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { managedStyleRootNode } from "@api/Styles";
import { PaintbrushIcon } from "@components/Icons";
import SettingsPlugin from "@plugins/_core/settings";
import { BRAND } from "@shared/brand";
import { onceReady } from "@webpack";
import { Devs } from "@utils/constants";
import { createAndAppendStyle } from "@utils/css";
import { Logger } from "@utils/Logger";
import { removeFromArray } from "@utils/misc";
import definePlugin, { IconProps, OptionType, StartAt } from "@utils/types";

import { brandingCss, startBranding, stopBranding } from "./branding";
import { HomePage } from "./HomePage";
import { layoutCss, MessageStyle } from "./layout";
import { MotionLevel, motionCss, startMotion, stopMotion } from "./motion";
import { buildRampCss, hexToHsl, readRamps } from "./palette";
import { StylePage } from "./StylePage";
import { CornerId, CORNERS, FontId, FONTS, getStyle } from "./styles";
import managedStyle from "./ui.css?managed";

const logger = new Logger("Mephedrone");

export const settings = definePluginSettings({
    style: { type: OptionType.CUSTOM, description: "", default: "terminal", onChange: () => apply() },
    accent: { type: OptionType.CUSTOM, description: "", default: "", onChange: () => apply() },
    font: { type: OptionType.CUSTOM, description: "", default: "", onChange: () => apply() },
    corners: { type: OptionType.CUSTOM, description: "", default: "", onChange: () => apply() },
    effects: { type: OptionType.CUSTOM, description: "", default: true, onChange: () => apply() },
    darkness: { type: OptionType.CUSTOM, description: "", default: 0, onChange: () => apply() },
    messages: { type: OptionType.CUSTOM, description: "", default: "", onChange: () => apply() },
    islands: { type: OptionType.CUSTOM, description: "", default: "", onChange: () => apply() },
    floatComposer: { type: OptionType.CUSTOM, description: "", default: "", onChange: () => apply() },
    motion: { type: OptionType.CUSTOM, description: "", default: "full" as MotionLevel, onChange: () => apply() },
});

let styleEl: HTMLStyleElement | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;

const HomeIcon = ({ width = 20, height = 20, className }: IconProps) => (
    <svg width={width} height={height} className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 3 2.5 11h2.7v9h5.3v-6h3v6h5.3v-9h2.7Z" />
    </svg>
);

export function resolved() {
    const s = settings.store;
    const style = getStyle(s.style);
    const font = (s.font || style.font) as FontId;
    const corners = (s.corners || style.corners) as CornerId;
    const accent = s.accent || style.accent;
    const pick = <T,>(v: any, d: T): T => v === "" || v == null ? d : v;
    return {
        style, font, corners, accent, effects: s.effects, darkness: s.darkness,
        messages: pick<MessageStyle>(s.messages, style.messages),
        islands: pick<boolean>(s.islands, style.islands),
        floatComposer: pick<boolean>(s.floatComposer, style.floatComposer),
    };
}

export function apply() {
    try {
        const { style, font, corners, accent, effects, darkness, messages, islands, floatComposer } = resolved();
        if (!readRamps().size) {
            // Discord's stylesheets aren't in yet (very early start); try again shortly
            retry ??= setTimeout(() => { retry = null; apply(); }, 500);
            return;
        }
        const neutral = style.neutral && darkness ? { ...style.neutral, darkScale: darkness } : style.neutral;
        const k = CORNERS[corners] ?? 1;
        const a = accent ? hexToHsl(accent) : null;

        const css = [
            buildRampCss(neutral, accent),
            `:root {
                --meph-accent: ${accent ?? "var(--brand-500)"};
                --meph-on-accent: ${a && a.l < 55 ? "#ffffff" : "#0a0a0d"};
                --meph-accent2: ${a ? `hsl(${(a.h + 55) % 360} ${a.s}% ${a.l}%)` : "var(--brand-500)"};
                --font-primary: ${FONTS[font]?.family ?? FONTS.discord.family};
                --font-display: var(--font-primary);
                --font-headline: var(--font-primary);
                ${font === "jetbrains" || font === "hack" ? `--font-code: ${FONTS[font].family};` : ""}
                --radius-xs: ${4 * k}px; --radius-sm: ${8 * k}px; --radius-md: ${12 * k}px;
                --radius-lg: ${16 * k}px; --radius-xl: ${24 * k}px;
            }`,
            k === 0 ? "html[data-meph-style] *:not([class*=\"avatar\"], [class*=\"status\"], [class*=\"dot\"], img) { border-radius: 0 !important; }" : "",
            style.css(effects),
            layoutCss({ messages, islands, floatComposer }),
            motionCss(settings.store.motion, style.id),
            brandingCss,
        ].join("\n");

        document.documentElement.dataset.mephStyle = style.id;
        styleEl ??= createAndAppendStyle("meph-style", managedStyleRootNode);
        styleEl.textContent = css;
        if (style.tokens) {
            const cs = getComputedStyle(document.documentElement);
            styleEl.textContent += "\n" + style.tokens(n => cs.getPropertyValue(n).trim(), effects);
        }
    } catch (e) {
        logger.error("Failed to apply style", e);
    }
}

export default definePlugin({
    name: "Mephedrone",
    description: `${BRAND} core: styles, palette engine and the ${BRAND} settings pages`,
    authors: [Devs.MephedroneTeam],
    required: true,
    dependencies: ["ThemeAttributes"],
    settings,
    managedStyle,

    startAt: StartAt.DOMContentLoaded,
    start() {
        apply();
        startBranding();
        onceReady.then(startMotion);
        SettingsPlugin.customEntries.unshift({ key: "meph_home", title: "Home", panelTitle: BRAND, Component: HomePage, Icon: HomeIcon });
        SettingsPlugin.customEntries.unshift({
            key: "meph_style",
            title: "Style",
            panelTitle: `${BRAND} Style`,
            Component: StylePage,
            Icon: PaintbrushIcon,
        });
    },
    stop() {
        stopMotion();
        stopBranding();
        styleEl?.remove();
        styleEl = null;
        delete document.documentElement.dataset.mephStyle;
        removeFromArray(SettingsPlugin.customEntries, e => e.key === "meph_style" || e.key === "meph_home");
    },
});
