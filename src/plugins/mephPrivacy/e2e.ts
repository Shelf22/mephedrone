/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// End-to-end encrypted messages between [MEPHEDRONE] users.
// AES-256-GCM with a key derived from a shared passphrase (PBKDF2-SHA256, 250k rounds, salted with the chat's ID).
// Wire format in the Discord message (readable for everyone, with a link to the web reader):
//   🔒 Encrypted message ([MEPHEDRONE]). Read it: <https://…/r#c=<channelId>&m=<base64url(12-byte IV ‖ ciphertext+tag)>>
// The part after # never leaves the reader's browser. Short form without link: 🔒meph2:<base64url…>
// Discord only ever stores the scrambled text. No forward secrecy: anyone with the passphrase can read old messages.

import * as DataStore from "@api/DataStore";
import { READER_URL } from "@shared/brand";

export const PREFIX = "🔒meph2:";
const LINK_LEAD = "🔒 Encrypted message ([MEPHEDRONE]). Read it: ";
export const MARKER = /(?:🔒meph2:|\/r(?:\.html)?#c=\d{5,25}&m=)([A-Za-z0-9_-]{24,})/;
export const isSealed = (content: string) => content.startsWith(PREFIX) || content.startsWith(LINK_LEAD);
const STORE = "MephE2E2";
// per-chat salt: the same passphrase gives a different key in every chat, and precomputed guesses don't carry over
const saltFor = (channelId: string) => new TextEncoder().encode("mephedrone-e2e-v2:" + channelId);

// ciphertext → plaintext for everything we've encrypted or decrypted, so it can be swapped in synchronously
const plainCache = new Map<string, string>();
export function cached(content: string) {
    const m = MARKER.exec(content);
    return m ? plainCache.get(m[1]) : undefined;
}
export const MAX_PLAIN = 1350; // keeps the encrypted form (with the reader link) under Discord's 2000 characters

interface Entry { key: string; on: boolean; }
let entries: Record<string, Entry> = {};
const keys = new Map<string, CryptoKey>();

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

export async function load() {
    entries = await DataStore.get<Record<string, Entry>>(STORE) ?? {};
}

const listeners = new Set<() => void>();
export const onChange = (f: () => void) => (listeners.add(f), () => void listeners.delete(f));
const save = async () => { await DataStore.set(STORE, entries); listeners.forEach(f => f()); };

async function importKey(raw: string) {
    return crypto.subtle.importKey("raw", unb64(raw) as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function keyFor(channelId: string) {
    const e = entries[channelId];
    if (!e) return null;
    let k = keys.get(channelId);
    if (!k) { k = await importKey(e.key); keys.set(channelId, k); }
    return k;
}

export async function setPassphrase(channelId: string, passphrase: string) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltFor(channelId), iterations: 250_000 }, base, 256);
    entries[channelId] = { key: b64(new Uint8Array(bits)), on: true };
    keys.delete(channelId);
    await save();
}

export async function forget(channelId: string) {
    delete entries[channelId];
    keys.delete(channelId);
    await save();
}

export async function setOn(channelId: string, on: boolean) {
    if (!entries[channelId]) return;
    entries[channelId].on = on;
    await save();
}

export const hasKey = (channelId: string) => !!entries[channelId];
export const isOn = (channelId: string) => !!entries[channelId]?.on;
export const lockedChannels = () => Object.entries(entries).map(([id, e]) => ({ id, on: e.on }));

export async function encrypt(channelId: string, text: string, withLink = true) {
    const k = await keyFor(channelId);
    if (!k) throw new Error("No key for this chat");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(text)));
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv);
    out.set(ct, iv.length);
    const body = b64(out);
    plainCache.set(body, text);
    return withLink ? `${LINK_LEAD}<${READER_URL}#c=${channelId}&m=${body}>` : PREFIX + body;
}

/** Plain text, or null if this isn't ours / we have no key / the key is wrong. */
export async function decrypt(channelId: string, content: string) {
    const m = MARKER.exec(content);
    if (!m) return null;
    const k = await keyFor(channelId);
    if (!k) return null;
    try {
        const data = unb64(m[1]);
        const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.subarray(0, 12) }, k, data.subarray(12));
        const text = new TextDecoder().decode(pt);
        plainCache.set(m[1], text);
        return text;
    } catch {
        return null;
    }
}
