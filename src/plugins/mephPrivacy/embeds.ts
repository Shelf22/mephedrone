/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Embed lockdown: Discord proxies images and link previews, but player embeds (Spotify, SoundCloud, …) are iframes
// that load straight from those companies, sending them your IP and running their trackers. Third-party iframes
// are held back and shown as a click-to-load placeholder. Discord's own frames and the captcha are allowed.

const ALLOWED = /(^|\.)(discord\.com|discordapp\.com|discordsays\.com|discord\.media|hcaptcha\.com|discordapp\.net)$/;

export const embedStats = { blocked: 0 };
const pending = new WeakMap<HTMLIFrameElement, string>();
let enabled = false;
let origSrc: PropertyDescriptor | undefined;
let origSetAttr: typeof Element.prototype.setAttribute | null = null;

function hostOf(src: string) { try { return new URL(src, location.href).hostname; } catch { return ""; } }
const isBlocked = (src: string) => {
    if (!enabled || !src || src.startsWith("about:") || src.startsWith("blob:") || src.startsWith("data:")) return false;
    const h = hostOf(src);
    return !!h && !ALLOWED.test(h);
};

function placeholder(frame: HTMLIFrameElement, src: string) {
    pending.set(frame, src);
    embedStats.blocked++;
    const host = hostOf(src).replace(/^www\./, "");
    queueMicrotask(() => {
        if (!frame.isConnected || frame.dataset.mephHeld) return;
        frame.dataset.mephHeld = "1";
        const box = document.createElement("button");
        box.className = "meph-embed-held";
        box.innerHTML = `<b>▶ Load ${host} embed</b><span>Connects you to ${host} (they'll see your IP and can track you)</span>`;
        box.style.width = frame.style.width || (frame.width ? `${frame.width}px` : "");
        box.style.height = frame.style.height || (frame.height ? `${frame.height}px` : "");
        box.onclick = () => {
            box.remove();
            delete frame.dataset.mephHeld;
            frame.style.display = "";
            origSetAttr!.call(frame, "src", src);
        };
        frame.style.display = "none";
        frame.before(box);
    });
}

export function startEmbedGuard() {
    if (origSetAttr) { enabled = true; return; }
    enabled = true;
    const IP = HTMLIFrameElement.prototype;
    origSrc = Object.getOwnPropertyDescriptor(IP, "src");
    origSetAttr = Element.prototype.setAttribute;
    const setAttr = origSetAttr;
    Object.defineProperty(IP, "src", {
        configurable: true,
        get() { return pending.get(this) ?? origSrc!.get!.call(this); },
        set(v: string) { if (isBlocked(String(v))) return placeholder(this, String(v)); origSrc!.set!.call(this, v); },
    });
    Element.prototype.setAttribute = function (name: string, value: string) {
        if (this instanceof HTMLIFrameElement && name.toLowerCase() === "src" && isBlocked(String(value))) return placeholder(this, String(value));
        return setAttr.call(this, name, value);
    };
}

/** stop holding new embeds (already-held ones keep their click-to-load button) */
export function stopEmbedGuard() { enabled = false; }
