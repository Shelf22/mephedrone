/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";

import { BUILTIN } from "./builtinCatalog";
import { setSaver, settingsChanged, startStorePlugin, stopStorePlugin } from "./runtime";
import { CatalogEntry, Installed, Manifest } from "./types";

const KEY = "MephStore";
export const BUILTIN_SOURCE = "built-in";

interface State { installed: Record<string, Installed>; sources: string[]; }
export const state: State = { installed: {}, sources: [] };

const listeners = new Set<() => void>();
export const onStoreChange = (f: () => void) => (listeners.add(f), () => void listeners.delete(f));

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function save() {
    listeners.forEach(f => f());
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => DataStore.set(KEY, state), 300);
}
setSaver(save);

export async function loadState() {
    const s = await DataStore.get<State>(KEY);
    state.installed = s?.installed ?? {};
    state.sources = s?.sources ?? [];
}

export async function sha256(text: string) {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function get(url: string) {
    const r = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).hostname}`);
    return r.text();
}

export interface SourceResult { source: string; name: string; entries: CatalogEntry[]; error?: string; }

export async function loadCatalogs(): Promise<SourceResult[]> {
    const out: SourceResult[] = [{ source: BUILTIN_SOURCE, name: "[MEPHEDRONE] built-in", entries: BUILTIN.map(e => ({ ...e, source: BUILTIN_SOURCE })) }];
    await Promise.all(state.sources.map(async src => {
        try {
            const idx = JSON.parse(await get(src));
            const entries: CatalogEntry[] = (idx.plugins ?? []).filter((p: any) => p?.id && p?.sha256 && p?.code)
                .map((p: CatalogEntry) => ({ ...p, source: src }));
            out.push({ source: src, name: String(idx.name ?? new URL(src).hostname), entries });
        } catch (e) {
            out.push({ source: src, name: src, entries: [], error: (e as Error).message });
        }
    }));
    return out;
}

const manifestOf = (e: CatalogEntry): Manifest => {
    const { sha256: _s, code: _c, codeText: _t, source: _src, ...m } = e;
    return { ...m, permissions: m.permissions ?? [] };
};

/** downloads (or takes the inline) code, refuses it unless its SHA-256 matches the index, then installs and starts it */
export async function install(entry: CatalogEntry) {
    const code = entry.codeText ?? await get(new URL(entry.code!, entry.source).href);
    const hash = await sha256(code);
    if (hash !== entry.sha256) throw new Error("The plugin's code doesn't match the store's fingerprint (SHA-256). Not installed.");
    const prev = state.installed[entry.id];
    if (prev) stopStorePlugin(entry.id);
    const plugin: Installed = {
        manifest: manifestOf(entry), code, sha256: hash, source: entry.source ?? BUILTIN_SOURCE,
        enabled: true, settings: prev?.settings ?? {}, storage: prev?.storage ?? {},
    };
    state.installed[entry.id] = plugin;
    save();
    startStorePlugin(plugin);
}

export function uninstall(id: string) {
    stopStorePlugin(id);
    delete state.installed[id];
    save();
}

export function setEnabled(id: string, on: boolean) {
    const p = state.installed[id];
    if (!p) return;
    p.enabled = on;
    on ? startStorePlugin(p) : stopStorePlugin(id);
    save();
}

export function setSetting(id: string, key: string, value: any) {
    const p = state.installed[id];
    if (!p) return;
    p.settings[key] = value;
    save();
    settingsChanged(id);
}

export function startAllEnabled() {
    for (const p of Object.values(state.installed)) if (p.enabled) startStorePlugin(p);
}

export const hasUpdate = (e: CatalogEntry) => {
    const p = state.installed[e.id];
    return !!p && p.sha256 !== e.sha256;
};

export const newPermissions = (e: CatalogEntry) => {
    const p = state.installed[e.id];
    const old = new Set([...(p?.manifest.permissions ?? []), ...(p?.manifest.network ?? []).map(d => "net:" + d)]);
    return [...e.permissions, ...(e.network ?? []).map(d => "net:" + d)].filter(x => !old.has(x));
};
