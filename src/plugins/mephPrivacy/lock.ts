/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Client lock screen: PIN/password at startup, after idle time, or instantly with the panic hotkey.
// It keeps people at your PC out of your chats. It is not encryption: the data on disk isn't protected by it.

import { BRAND, BRAND_LOGO } from "@shared/brand";
import { localStorage } from "@utils/localStorage";

let overlay: HTMLDivElement | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let idleMs = 0;
let getHash: () => string = () => "";

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");

/** "salt:hash" for storing */
export async function hashPin(pin: string, salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer)) {
    const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 200_000 }, base, 256);
    return `${salt}:${hex(bits)}`;
}

const FAILS_KEY = "meph-lock-fails";
function readFails(): { n: number; until: number; } {
    try { return { n: 0, until: 0, ...JSON.parse(localStorage.getItem(FAILS_KEY) ?? "{}") }; } catch { return { n: 0, until: 0 }; }
}
function writeFails(f: { n: number; until: number; }) {
    try { localStorage.setItem(FAILS_KEY, JSON.stringify(f)); } catch { }
}

async function check(pin: string) {
    const stored = getHash();
    if (!stored) return true;
    const [salt] = stored.split(":");
    return (await hashPin(pin, salt)) === stored;
}

export const isLocked = () => !!overlay;

export function lock() {
    if (overlay || !getHash()) return;
    overlay = document.createElement("div");
    overlay.id = "meph-lock";
    overlay.innerHTML = `
        <div class="meph-lock-box">
            <img src="${BRAND_LOGO}" width="72" height="72" alt="">
            <div class="meph-lock-title">${BRAND}</div>
            <div class="meph-lock-sub">Locked</div>
            <form><input type="password" autocomplete="off" placeholder="PIN or password" aria-label="PIN or password"></form>
            <div class="meph-lock-err"></div>
        </div>`;
    const form = overlay.querySelector("form")!;
    const input = overlay.querySelector("input")!;
    const err = overlay.querySelector<HTMLDivElement>(".meph-lock-err")!;
    form.addEventListener("submit", async e => {
        e.preventDefault();
        const f = readFails();
        if (Date.now() < f.until) return void (err.textContent = `Wait ${Math.ceil((f.until - Date.now()) / 1000)}s`);
        if (await check(input.value)) { writeFails({ n: 0, until: 0 }); return unlock(); }
        // survives reloads/restarts: 3 free tries, then 30s, 60s, 120s… up to 5 minutes per try
        f.n++;
        const wait = f.n > 3 ? Math.min(30_000 * 2 ** (f.n - 4), 300_000) : 0;
        writeFails({ n: f.n, until: Date.now() + wait });
        input.value = "";
        err.textContent = wait ? `Wrong PIN, wait ${wait / 1000}s` : "Wrong PIN";
        overlay?.querySelector(".meph-lock-box")?.animate([{ translate: "-8px" }, { translate: "8px" }, { translate: "0" }], 200);
    });
    // keys typed inside the lock never reach Discord
    for (const t of ["keydown", "keyup", "keypress", "paste"]) overlay.addEventListener(t, e => e.stopPropagation());
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.body.appendChild(overlay);
    input.focus();
    for (const t of GUARDED) addEventListener(t, guard, true);
}

// While locked, anything aimed outside the lock box is swallowed and focus goes back to the PIN field
const GUARDED = ["keydown", "keyup", "keypress", "paste", "focusin", "beforeinput", "drop"];
function guard(e: Event) {
    if (!overlay || overlay.contains(e.target as Node)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    overlay.querySelector("input")?.focus();
}

function unlock() {
    for (const t of GUARDED) removeEventListener(t, guard, true);
    overlay?.remove();
    overlay = null;
    bump();
}

function bump() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = idleMs ? setTimeout(lock, idleMs) : null;
}

function onKey(e: KeyboardEvent) {
    if (e.ctrlKey && e.shiftKey && e.code === "KeyL") { e.preventDefault(); lock(); return; }
    if (!overlay) bump();
}

export function startLock(opts: { hash: () => string; idleMinutes: number; lockNow: boolean; }) {
    getHash = opts.hash;
    idleMs = Math.max(0, opts.idleMinutes) * 60000;
    addEventListener("keydown", onKey, true);
    addEventListener("pointerdown", bump, true);
    addEventListener("wheel", bump, { capture: true, passive: true });
    if (opts.lockNow) lock();
    bump();
}

export function setIdle(minutes: number) {
    idleMs = Math.max(0, minutes) * 60000;
    bump();
}

export function stopLock() {
    removeEventListener("keydown", onKey, true);
    removeEventListener("pointerdown", bump, true);
    removeEventListener("wheel", bump, true);
    if (idleTimer) clearTimeout(idleTimer);
    for (const t of GUARDED) removeEventListener(t, guard, true);
    overlay?.remove();
    overlay = null;
}
