/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// [MEPHEDRONE] motion system: animations + custom UI chrome. Levels: off | subtle | full.
// Only messages that *arrive* animate (not history), so opening a chat stays instant.

import { FluxDispatcher } from "@webpack/common";

import { c } from "./styles";

export type MotionLevel = "off" | "subtle" | "full";

const is = (...n: string[]) => `:is(${n.map(c).join(",")})`;
// the channel header: "headerBar" on some pages, a <section> inside "subtitleContainer" in chats
const HEADER = `:is(${is("headerBar")}, :is(${is("subtitleContainer")}) > section)`;

/** CSS for a motion level; `k` scales distances/durations (subtle = calmer) */
export function motionCss(level: MotionLevel, styleId: string) {
    if (level === "off") return "";
    const full = level === "full";
    const k = full ? 1 : 0.55;
    const ms = (n: number) => `${Math.round(n * (full ? 1 : 0.8))}ms`;
    const ease = "cubic-bezier(.2,.8,.2,1)";
    const spring = "cubic-bezier(.34,1.56,.64,1)";

    return `
@media (prefers-reduced-motion: no-preference) {

/* ---------- messages that just arrived */
@keyframes meph-msg-in { from { opacity: 0; transform: translateY(${10 * k}px) scale(${1 - 0.015 * k}); } to { opacity: 1; transform: none; } }
li.meph-new { animation: meph-msg-in ${ms(380)} ${spring} both; }
li.meph-new[data-is-self="true"] { animation-name: meph-msg-in-self; }
@keyframes meph-msg-in-self { from { opacity: 0; transform: translateX(${14 * k}px) scale(${1 - 0.02 * k}); } to { opacity: 1; transform: none; } }

/* ---------- channel switch: the chat rises in */
@keyframes meph-rise { from { opacity: 0; transform: translateY(${8 * k}px); } to { opacity: 1; transform: none; } }
.meph-switching ${is("chatContent")}, .meph-switching ${is("contentSection")} { animation: meph-rise ${ms(320)} ${ease} both; }

/* ---------- server list (the [data-list-item-id] element is the icon wrapper itself) */
[data-list-item-id^="guildsnav___"] { transition: transform ${ms(220)} ${spring}, filter ${ms(220)} ease !important; }
[data-list-item-id^="guildsnav___"]:hover {
    transform: translateY(-2px) scale(${1 + 0.07 * k}) !important;
    filter: drop-shadow(0 4px 12px color-mix(in srgb, var(--meph-accent) ${full ? 60 : 35}%, transparent));
}
[data-list-item-id^="guildsnav___"]:active { transform: scale(${1 - 0.05 * k}) !important; }
${is("guilds")} ${is("item")} { transition: height ${ms(260)} ${spring}, transform ${ms(260)} ${spring} !important; background: var(--meph-accent) !important; }

/* ---------- channel list + DM list */
:is([data-list-item-id^="channels___"], [data-list-item-id^="private-channels"]) > div, ${is("link")} {
    transition: transform ${ms(180)} ${ease}, background-color ${ms(180)} ease;
}
:is([data-list-item-id^="channels___"], [data-list-item-id^="private-channels"]):hover > div { transform: translateX(${3 * k}px); }

/* ---------- buttons: hover lift + press squish */
button:not([role="switch"]):not([class*="meph-"]) { transition: transform ${ms(140)} ${ease}, filter ${ms(140)} ease, background-color ${ms(160)} ease; }
button:not([role="switch"]):not([class*="meph-"]):active { transform: scale(${1 - 0.04 * k}); }

/* ---------- menus, popouts, modals */
@keyframes meph-pop { from { opacity: 0; transform: translateY(${-4 * k}px) scale(${1 - 0.04 * k}); } to { opacity: 1; transform: none; } }
${is("menu")}, ${is("userPopoutOuter")}, ${is("popout")}, ${is("autocomplete")} { animation: meph-pop ${ms(190)} ${spring} both; transform-origin: top left; }
@keyframes meph-modal { from { opacity: 0; transform: scale(${1 - 0.06 * k}); filter: blur(${3 * k}px); } to { opacity: 1; transform: none; filter: none; } }
${is("focusLock")} > ${is("root")}, [role="dialog"] > ${is("root")} { animation: meph-modal ${ms(260)} ${spring} both; }
${is("backdrop")} { backdrop-filter: blur(${full ? 6 : 3}px); transition: backdrop-filter ${ms(300)} ease; }
@keyframes meph-fade { from { opacity: 0; } to { opacity: 1; } }
${is("tooltip")} { animation: meph-fade ${ms(140)} ease both; }

/* ---------- typing dots + unread/mention pills */
@keyframes meph-dot { 0%, 80%, 100% { transform: translateY(0); opacity: .45; } 40% { transform: translateY(-${3 * k}px); opacity: 1; } }
${is("typingDots")} circle, ${is("dots")} circle { fill: var(--meph-accent) !important; }
@keyframes meph-pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--status-danger, #f23f43) 55%, transparent); } 70% { box-shadow: 0 0 0 ${6 * k}px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
${is("numberBadge")}, ${is("lowerBadge")} ${is("numberBadge")} { animation: meph-pulse ${full ? "2.2s" : "3.2s"} ease-out infinite; }

/* ---------- header: animated accent underline */
${HEADER} { position: relative; }
${HEADER}::after {
    content: ""; position: absolute; left: 16px; right: 16px; bottom: 0; height: 2px; border-radius: 2px;
    background: linear-gradient(90deg, transparent, var(--meph-accent), var(--meph-accent2), transparent);
    background-size: 200% 100%; opacity: .55;
    ${full ? "animation: meph-sheen 6s linear infinite;" : ""}
}
@keyframes meph-sheen { from { background-position: 200% 0; } to { background-position: -200% 0; } }

/* ---------- user panel: accent ring + soft glow */
${is("panels")} ${is("avatar")} { box-shadow: 0 0 0 2px var(--meph-accent), 0 0 ${full ? 14 : 8}px -2px var(--meph-accent); border-radius: 50%; transition: box-shadow ${ms(300)} ease; }
${is("panels")} ${is("avatarWrapper")}:hover ${is("avatar")} { box-shadow: 0 0 0 2px var(--meph-accent), 0 0 ${full ? 22 : 12}px 0 var(--meph-accent); }

/* ---------- message hover: accent edge slides in */
li[data-is-self] > ${is("message")} { transition: background-color ${ms(160)} ease, box-shadow ${ms(200)} ease; }
li[data-is-self] > ${is("message")}:hover { box-shadow: inset ${full ? 3 : 2}px 0 0 var(--meph-accent); }

${styleCss(styleId, full, k, ms)}
}`;
}

/** per-style ambience */
function styleCss(styleId: string, full: boolean, k: number, ms: (n: number) => string) {
    if (styleId === "glass") return `
/* drifting glows behind the glass */
@keyframes meph-drift { 0% { background-position: 0% 0%, 100% 100%, 70% 0%; } 50% { background-position: 18% 12%, 82% 88%, 50% 20%; } 100% { background-position: 0% 0%, 100% 100%, 70% 0%; } }
${is("bg")} { background-size: 140% 140%, 140% 140%, 120% 120%, auto !important; animation: meph-drift ${full ? "26s" : "40s"} ease-in-out infinite; }`;
    if (styleId === "terminal") return `
/* CRT power-on, blinking block caret */
@keyframes meph-crt { 0% { opacity: 0; transform: scaleY(.004) scaleX(.6); filter: brightness(3); } 45% { opacity: 1; transform: scaleY(.004) scaleX(1); } 100% { transform: none; filter: none; } }
html.meph-boot ${is("app")} { animation: meph-crt ${full ? "700ms" : "450ms"} cubic-bezier(.2,.9,.3,1) both; transform-origin: center; }
@keyframes meph-caret { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
${is("placeholder")}::after { content: "█"; margin-left: 2px; color: var(--meph-accent); animation: meph-caret 1.05s steps(1) infinite; }
${HEADER} :is(h1, h2, h3) { text-shadow: 0 0 ${full ? 8 : 4}px color-mix(in srgb, var(--meph-accent) 60%, transparent); }`;
    return "";
}

// ---------- JS side: tag arriving messages, replay the channel-switch animation, boot class

const fresh = new Set<string>();
let observer: MutationObserver | null = null;
let switchTimer: ReturnType<typeof setTimeout> | null = null;

// nonces of own messages already animated as their instant (optimistic) copy
const sentNonces = new Set<string>();

function onMessage({ message, optimistic }: any) {
    if (!message?.id) return;
    // your own message renders as an instant copy (id = nonce), then the server's copy (real id, same nonce) replaces
    // it, sometimes dispatched twice and also flagged optimistic. Only the instant copy animates.
    const { nonce } = message;
    if (nonce && sentNonces.has(nonce) && message.id !== nonce) return;
    if (optimistic && nonce && message.id === nonce) sentNonces.add(nonce);
    fresh.add(message.id);
    setTimeout(() => { fresh.delete(message.id); if (message.nonce) sentNonces.delete(message.nonce); }, 15000);
}

function onChannelSelect() {
    const root = document.documentElement;
    root.classList.remove("meph-switching");
    void root.offsetWidth;
    root.classList.add("meph-switching");
    if (switchTimer) clearTimeout(switchTimer);
    switchTimer = setTimeout(() => root.classList.remove("meph-switching"), 600);
}

export function startMotion() {
    if (observer) return;
    FluxDispatcher.subscribe("MESSAGE_CREATE", onMessage);
    FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
    observer = new MutationObserver(muts => {
        if (!fresh.size) return;
        for (const m of muts) for (const n of m.addedNodes) {
            if (!(n instanceof HTMLElement) || n.tagName !== "LI" || !n.id?.startsWith("chat-messages-")) continue;
            const id = n.id.split("-").pop()!;
            if (fresh.has(id)) n.classList.add("meph-new");
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.documentElement.classList.add("meph-boot");
    setTimeout(() => document.documentElement.classList.remove("meph-boot"), 1500);
}

export function stopMotion() {
    FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessage);
    FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect);
    observer?.disconnect();
    observer = null;
}
