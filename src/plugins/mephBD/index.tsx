/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import SettingsPlugin from "@plugins/_core/settings";
import { BRAND } from "@shared/brand";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { removeFromArray } from "@utils/misc";
import definePlugin, { IconProps, OptionType } from "@utils/types";

import { BdApi, loadData } from "./bdapi";
import { BDPage } from "./BDPage";
import { BD_CATALOG, BD_LIBS, BDEntry } from "./catalog";
import { loadLibrary, loaded, setPluginsApi, startBD, stopBD } from "./loader";
import managedStyle from "./bd.css?managed";

const logger = new Logger("MephBD");

export const settings = definePluginSettings({
    optIn: { type: OptionType.CUSTOM, description: "", default: false },
    enabled: { type: OptionType.CUSTOM, description: "", default: {} as Record<string, boolean> },
});

const listeners = new Set<() => void>();
export const onBDChange = (f: () => void) => (listeners.add(f), () => void listeners.delete(f));
const changed = () => listeners.forEach(f => f());

async function sha256(text: string) {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

const byName = (n: string) => BD_CATALOG.find(e => e.name === n);

/** starts a verified plugin, re-checking its fingerprint first */
export async function enableBD(entry: BDEntry) {
    if (!settings.store.optIn) throw new Error("Turn on BetterDiscord plugins first");
    if (await sha256(entry.code) !== entry.sha256) throw new Error("Fingerprint mismatch, refusing to run");
    for (const libName of entry.libs ?? []) {
        const lib = BD_LIBS.find(l => l.name === libName);
        if (!lib) throw new Error(`Missing library ${libName}`);
        if (await sha256(lib.code) !== lib.sha256) throw new Error(`${libName} fingerprint mismatch, refusing to run`);
        loadLibrary(lib.name, lib.code);
    }
    settings.store.enabled = { ...settings.store.enabled, [entry.name]: true };
    const r = startBD(entry.name, entry.code);
    changed();
    if (r.error) throw new Error(r.error.split("\n")[0]);
}

export function disableBD(entry: BDEntry) {
    settings.store.enabled = { ...settings.store.enabled, [entry.name]: false };
    stopBD(entry.name);
    changed();
}

export function setOptIn(on: boolean) {
    settings.store.optIn = on;
    if (on) { (window as any).BdApi = BdApi; startEnabled(); }
    else { for (const n of loaded.keys()) stopBD(n); delete (window as any).BdApi; }
    changed();
}

function startEnabled() {
    for (const [name, on] of Object.entries(settings.store.enabled)) {
        const e = on && byName(name);
        if (e) enableBD(e).catch(err => logger.error(name, err));
    }
}

const BDIcon = ({ width = 20, height = 20, className }: IconProps) => (
    <svg width={width} height={height} className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M5 3h7a5 5 0 0 1 3.6 8.5A5 5 0 0 1 13 21H5Zm3 3v4h4a2 2 0 0 0 0-4Zm0 7v5h5a2.5 2.5 0 0 0 0-5Z" />
    </svg>
);

export default definePlugin({
    name: "MephBD",
    description: `${BRAND} BetterDiscord compatibility: run reviewed, fingerprint-pinned BetterDiscord plugins (opt-in)`,
    authors: [Devs.MephedroneTeam],
    required: true,
    settings,
    managedStyle,
    dependencies: ["ContextMenuAPI"],

    _dev: IS_DEV ? { startBD, stopBD, loaded, BD_CATALOG, BD_LIBS, loadLibrary, setOptIn } : undefined,

    async start() {
        await loadData();
        setPluginsApi({
            isEnabled: n => !!loaded.get(n)?.started,
            get: n => { const l = loaded.get(n); return l && { ...l.meta, instance: l.instance, exports: l.instance }; },
            getAll: () => [...loaded.values()].map(l => ({ ...l.meta, instance: l.instance })),
            enable: n => { const e = byName(n); if (e) enableBD(e).catch(() => { }); },
            disable: n => { const e = byName(n); if (e) disableBD(e); },
            toggle: n => { const e = byName(n); if (e) loaded.get(n)?.started ? disableBD(e) : enableBD(e).catch(() => { }); },
            reload: () => { },
            folder: "",
        });
        SettingsPlugin.customEntries.push({ key: "meph_bd", title: "BetterDiscord", panelTitle: `${BRAND} BetterDiscord`, Component: BDPage, Icon: BDIcon });
        if (settings.store.optIn) { (window as any).BdApi = BdApi; startEnabled(); }
    },

    stop() {
        for (const n of loaded.keys()) stopBD(n);
        delete (window as any).BdApi;
        removeFromArray(SettingsPlugin.customEntries, e => e.key === "meph_bd");
    },
});
