/*
 * Hideaway - Vencord plugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Lock state, the hidden server/DM lists and the passcode. Everything lives
 * in Vencord's DataStore (IndexedDB) rather than settings.json, so it stays
 * on this machine and is never uploaded by Vencord's cloud settings sync.
 */

import * as DataStore from "@api/DataStore";
import { ChannelStore } from "@webpack/common";

const STORAGE_KEY = "Hideaway_data";
const PBKDF2_ITERATIONS = 210_000;

interface Passcode {
    salt: string;
    hash: string;
    iterations: number;
}

interface Data {
    guilds: string[];
    channels: string[];
    passcode?: Passcode;
}

let data: Data = { guilds: [], channels: [] };
let hiddenGuilds = new Set<string>();
let hiddenChannels = new Set<string>();
let loaded = false;
let unlocked = false;
let version = 0;

const listeners = new Set<() => void>();
const lockListeners = new Set<() => void>();

export function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

/** Called after every lock, whatever triggered it. */
export function onLock(listener: () => void) {
    lockListeners.add(listener);
    return () => void lockListeners.delete(listener);
}

export const getVersion = () => version;
export const isLoaded = () => loaded;
export const isUnlocked = () => unlocked;
export const hasPasscode = () => !!data.passcode;

function emit() {
    version++;
    for (const listener of listeners) listener();
}

function rebuild() {
    hiddenGuilds = new Set(data.guilds);
    hiddenChannels = new Set(data.channels);
}

export async function load() {
    const stored = await DataStore.get<Data>(STORAGE_KEY);
    if (stored) {
        data = {
            guilds: Array.isArray(stored.guilds) ? stored.guilds : [],
            channels: Array.isArray(stored.channels) ? stored.channels : [],
            passcode: stored.passcode
        };
    }
    rebuild();
    loaded = true;
    emit();
}

export function reset() {
    data = { guilds: [], channels: [] };
    rebuild();
    loaded = false;
    unlocked = false;
    emit();
}

const save = () => DataStore.set(STORAGE_KEY, data);

/* ---------- membership ---------- */

export const isGuildHidden = (guildId: string | null | undefined) => !!guildId && hiddenGuilds.has(guildId);
export const isChannelHidden = (channelId: string | null | undefined) => !!channelId && hiddenChannels.has(channelId);

/**
 * Whether a server should be kept out of sight right now. Until the lists
 * have loaded we can't tell which servers are hidden, so everything is.
 */
export function isGuildConcealed(guildId: string | null | undefined) {
    if (!guildId) return false;
    if (!loaded) return true;
    return !unlocked && hiddenGuilds.has(guildId);
}

/** Same for a DM / group DM, or any channel inside a hidden server. */
export function isChannelConcealed(channelId: string | null | undefined) {
    if (!channelId) return false;
    if (!loaded) return true;
    if (unlocked) return false;
    if (hiddenChannels.has(channelId)) return true;
    const guildId = ChannelStore.getChannel(channelId)?.guild_id;
    return !!guildId && hiddenGuilds.has(guildId);
}

export function setGuildHidden(guildId: string, hidden: boolean) {
    data.guilds = data.guilds.filter(id => id !== guildId);
    if (hidden) data.guilds.push(guildId);
    rebuild();
    emit();
    return save();
}

export function setChannelHidden(channelId: string, hidden: boolean) {
    data.channels = data.channels.filter(id => id !== channelId);
    if (hidden) data.channels.push(channelId);
    rebuild();
    emit();
    return save();
}

/* ---------- passcode ---------- */

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;

async function derive(passcode: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(passcode), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
    return new Uint8Array(bits);
}

function equal(a: Uint8Array, b: Uint8Array) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
}

export async function checkPasscode(passcode: string) {
    const stored = data.passcode;
    if (!stored) return false;
    const hash = await derive(passcode, fromB64(stored.salt), stored.iterations);
    return equal(hash, fromB64(stored.hash));
}

export async function setPasscode(passcode: string) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derive(passcode, salt, PBKDF2_ITERATIONS);
    data.passcode = { salt: toB64(salt), hash: toB64(hash), iterations: PBKDF2_ITERATIONS };
    await save();
}

/* ---------- lock state ---------- */

export async function unlock(passcode: string) {
    if (!loaded || !(await checkPasscode(passcode))) return false;
    unlocked = true;
    emit();
    return true;
}

/** Only for the first-time setup, right after the passcode was created. */
export function unlockAfterSetup() {
    if (!loaded || !data.passcode) return;
    unlocked = true;
    emit();
}

export function lock() {
    if (!unlocked) return;
    unlocked = false;
    emit();
    for (const listener of lockListeners) listener();
}
