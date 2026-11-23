/*
 * HideMicMutedNotice — hides Discord's "hardware mute switch might be on" nag.
 *
 * Matching is on text, not class: the notice bar renders every message with the
 * same notice__/colorInfo__ classes, so a CSS rule would also hide connection
 * warnings and account notices. Discord's class hashes churn across updates
 * anyway; the wording is the stable part.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const STYLE_ID = "vc-hide-mic-muted-notice";
const HIDDEN_CLASS = "vc-hidden-notice";

const settings = definePluginSettings({
    pattern: {
        type: OptionType.STRING,
        description: "Hide notices whose text contains this (case-insensitive). Blank = hide nothing.",
        default: "hardware mute switch",
        onChange: () => resweep()
    }
});

let observer: MutationObserver | null = null;

function isTargetNotice(el: Element) {
    // className is an SVGAnimatedString on svg elements, hence the typeof guard.
    const cls = el.className;
    if (typeof cls !== "string" || !cls.includes("notice")) return false;

    const needle = settings.store.pattern?.trim().toLowerCase();
    return !!needle && (el.textContent || "").toLowerCase().includes(needle);
}

function consider(el: Element) {
    if (isTargetNotice(el)) el.classList.add(HIDDEN_CLASS);
}

/** Full re-evaluation. Only on start and settings change, so the cost is fine. */
function resweep() {
    document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(el => el.classList.remove(HIDDEN_CLASS));
    document.querySelectorAll('[class*="notice"]').forEach(consider);
}

function onMutations(mutations: MutationRecord[]) {
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (!(node instanceof Element)) continue;
            // The notice is inserted as its own node, so one level down is plenty
            // and keeps this off Discord's hot path while scrolling.
            consider(node);
            Array.from(node.children).forEach(consider);
        }
    }
}

export default definePlugin({
    name: "HideMicMutedNotice",
    description: "Hides Discord's \"microphone hardware mute switch might be on\" notice, which misfires on Linux.",
    authors: [{ name: "broroeror", id: 0n }],
    settings,

    start() {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `.${HIDDEN_CLASS} { display: none !important; }`;
        document.head.appendChild(style);

        resweep();

        observer = new MutationObserver(onMutations);
        observer.observe(document.body, { childList: true, subtree: true });
    },

    stop() {
        observer?.disconnect();
        observer = null;
        document.getElementById(STYLE_ID)?.remove();
        document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(el => el.classList.remove(HIDDEN_CLASS));
    }
});
