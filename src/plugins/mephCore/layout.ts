/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Structural reworks of Discord's UI: message styles, island layout, floating composer.
// Messages are told apart with ThemeAttributes' data-is-self on each list item.

import { c } from "./styles";

export type MessageStyle = "bubbles" | "terminal" | "classic";

const is = (...names: string[]) => `:is(${names.map(c).join(",")})`;
const MSG = `li[data-is-self] > ${is("message")}`;
const SELF = `li[data-is-self="true"] > ${is("message")}`;
const OTHER = `li[data-is-self="false"] > ${is("message")}`;
const CONTENT = is("messageContent");
const ACC = "[id^=\"message-accessories-\"]";

const bubbles = `
${MSG} { padding-right: 18% !important; }
${MSG} ${CONTENT} {
    width: fit-content; max-width: 100%; box-sizing: border-box;
    padding: 7px 13px; margin-top: 2px; border-radius: 18px;
    background: var(--background-surface-higher, var(--background-base-low));
    line-height: 1.4;
}
${OTHER} ${is("groupStart")} ${CONTENT}, ${OTHER}${is("groupStart")} ${CONTENT} { border-top-left-radius: 6px; }

/* yours: right side, accent bubble, no avatar or name */
${SELF} { padding-left: 18% !important; padding-right: 16px !important; }
${SELF} ${is("avatar", "header")} { display: none !important; }
${SELF} ${CONTENT} {
    margin-left: auto; text-align: left;
    background: var(--meph-accent); color: var(--meph-on-accent, #0a0a0d);
    border-top-right-radius: 6px;
}
${SELF} ${CONTENT} :is(a, code, ${c("mention")}) { color: inherit; }
${SELF} ${is("timestampVisibleOnHover")} { left: auto !important; right: 4px; }
${SELF} ${ACC} { display: flex; flex-direction: column; align-items: flex-end; }
${SELF} ${is("repliedMessage")} { justify-content: flex-end; }
li[data-is-self] ${is("groupStart")} { margin-top: 10px !important; }
`;

const terminal = `
${MSG} { padding-left: 14px !important; min-height: 0 !important; margin-top: 0 !important; }
${MSG} ${is("avatar")} { display: none !important; }
${MSG} ${is("contents")} { display: block; line-height: 1.45; }
${MSG} ${is("header")} { display: inline-flex; flex-direction: row; margin: 0 6px 0 0 !important; vertical-align: baseline; }
${MSG} ${is("header")} ${is("timestamp")} { order: -1; margin: 0 6px 0 0 !important; }
${MSG} ${is("headerText")} { display: inline; margin: 0 !important; }
${MSG} ${is("headerText")}::before { content: "<"; color: var(--text-muted); }
${MSG} ${is("headerText")}::after { content: ">"; color: var(--text-muted); }
${MSG} ${CONTENT} { display: inline; }
${MSG} ${is("timestamp")} time::before { content: "["; }
${MSG} ${is("timestamp")} time::after { content: "]"; }
${MSG} ${is("timestampVisibleOnHover")} {
    position: static !important; display: inline !important; opacity: .55 !important; visibility: visible !important;
    width: auto !important; margin-right: 6px; font-size: .75rem;
}
${SELF} ${is("username")} { color: var(--meph-accent) !important; }
li[data-is-self] ${is("groupStart")} { margin-top: 6px !important; }
`;

const islands = `
${is("base")} > ${is("content")} { padding: 0 8px 8px 0; gap: 8px; box-sizing: border-box; }
${is("sidebarList")} { border-radius: var(--radius-md) !important; margin-bottom: 72px; overflow: hidden; border: 0 !important; }
${is("page")} { border-radius: var(--radius-md); overflow: hidden; border: 0 !important; }
${is("panels")} { border-radius: var(--radius-md) !important; }
${is("guilds")} { margin-right: 0 !important; }
`;

const floatingComposer = `
${is("channelTextArea")} {
    border-radius: 22px !important; margin-bottom: 4px;
    box-shadow: 0 6px 24px rgb(0 0 0 / 28%), inset 0 0 0 1px color-mix(in srgb, var(--meph-accent) 22%, transparent) !important;
}
${is("channelTextArea")}:focus-within {
    box-shadow: 0 6px 24px rgb(0 0 0 / 28%), inset 0 0 0 1.5px var(--meph-accent) !important;
}
form${is("form")} { padding-left: 20px !important; padding-right: 20px !important; }
`;

export function layoutCss(opts: { messages: MessageStyle; islands: boolean; floatComposer: boolean; }) {
    return [
        opts.messages === "bubbles" ? bubbles : opts.messages === "terminal" ? terminal : "",
        opts.islands ? islands : "",
        opts.floatComposer ? floatingComposer : "",
    ].join("\n");
}
