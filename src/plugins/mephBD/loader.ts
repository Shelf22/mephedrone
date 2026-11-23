/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Runs BetterDiscord .plugin.js files the way BetterDiscord does (module.exports = class | factory, start/stop).
// Only code from the verified catalog is ever passed in here (checked against its SHA-256 first).

import { React } from "@webpack/common";

import { BdApi, BDReactDOM, PluginsRef } from "./bdapi";
import { unpatchAll } from "./patcher";

export interface BDMeta { name: string; author?: string; version?: string; description?: string; source?: string; website?: string; [k: string]: any; }
export interface Loaded { meta: BDMeta; instance: any; started: boolean; error?: string; }

export function parseMeta(code: string): BDMeta {
    const block = /\/\*\*([\s\S]*?)\*\//.exec(code)?.[1] ?? "";
    const meta: BDMeta = { name: "" };
    for (const m of block.matchAll(/@(\w+)[ \t]+([^\n\r]+)/g)) meta[m[1]] = m[2].trim();
    return meta;
}

const NODE_SHIMS: Record<string, any> = {
    get react() { return React; },
    get "react-dom"() { return BDReactDOM; },
    get "react-dom/client"() { return BDReactDOM; },
};

function requireShim(name: string) {
    if (name in NODE_SHIMS) return NODE_SHIMS[name];
    throw new Error(`require("${name}") isn't available in [MEPHEDRONE]`);
}

// Harmless stand-ins for the Node modules ZeresPluginLibrary loads at startup. Its updater uses them to
// download and overwrite plugins, which would bypass fingerprint pinning, so writes do nothing and
// network requests always fail.
const noop = () => { };
const LIB_SHIMS: Record<string, any> = {
    fs: new Proxy({}, { get: (_t, k) => k === "existsSync" ? () => false : k === "readFileSync" ? () => "" : k === "promises" ? { writeFile: async () => { }, readFile: async () => "" } : noop }),
    path: {
        join: (...p: string[]) => p.filter(Boolean).join("/").replace(/\/+/g, "/"),
        resolve: (...p: string[]) => p.filter(Boolean).join("/").replace(/\/+/g, "/"),
        basename: (p: string, ext?: string) => { const b = String(p).split("/").pop() ?? ""; return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; },
        dirname: (p: string) => String(p).split("/").slice(0, -1).join("/") || "/",
        extname: (p: string) => /\.[^./]+$/.exec(String(p))?.[0] ?? "",
        sep: "/",
    },
    request: Object.assign((_u: any, cb?: any) => cb?.(new Error("Network requests from libraries are disabled in [MEPHEDRONE]")), {
        get: (_u: any, cb?: any) => cb?.(new Error("Network requests from libraries are disabled in [MEPHEDRONE]")),
    }),
    process: { env: {}, platform: "linux", versions: {} },
    electron: { shell: { openExternal: noop } },
};
const libRequire = (name: string) => name in LIB_SHIMS ? LIB_SHIMS[name] : requireShim(name);

export const libsLoaded = new Set<string>();

/** Loads a verified library (e.g. ZeresPluginLibrary) once, then removes its remote-code and self-update paths. */
export function loadLibrary(name: string, code: string) {
    if (libsLoaded.has(name)) return;
    if (!(window as any).BdApi) (window as any).BdApi = BdApi;
    const mod: { exports: any; } = { exports: {} };
    const run = new Function("module", "exports", "require", "global", "__filename", "__dirname",
        `${code}\n//# sourceURL=betterdiscord/lib/${encodeURIComponent(name)}.plugin.js`);
    run(mod, mod.exports, libRequire, window, `${name}.plugin.js`, "");
    const Z = (window as any).ZLibrary;
    if (Z) {
        const refuse = () => Promise.reject(new Error("Loading remote scripts is disabled in [MEPHEDRONE]"));
        if (Z.DOMTools) Z.DOMTools.addScript = refuse;
        if (Z.PluginUpdater) {
            for (const k of ["checkForUpdate", "processUpdateCheck", "downloadPlugin", "showUpdateNotice", "checkAll", "patchPluginList"])
                if (typeof Z.PluginUpdater[k] === "function") Z.PluginUpdater[k] = () => Promise.resolve(false);
        }
    }
    libsLoaded.add(name);
}

export const loaded = new Map<string, Loaded>();

export function instantiate(code: string): Loaded {
    const meta = parseMeta(code);
    const mod: { exports: any; } = { exports: {} };
    // eslint-disable-next-line no-new-func
    if (!(window as any).BdApi) (window as any).BdApi = BdApi;
    const run = new Function("module", "exports", "require", "global", "__filename", "__dirname",
        `${code}\n//# sourceURL=betterdiscord/${encodeURIComponent(meta.name || "plugin")}.plugin.js`);
    run(mod, mod.exports, requireShim, window, `${meta.name}.plugin.js`, "");
    let exp = mod.exports;
    if (exp && typeof exp === "object" && typeof exp.default === "function") exp = exp.default;
    let instance: any;
    if (typeof exp === "function") {
        const isClass = /^class[\s{]/.test(Function.prototype.toString.call(exp)) || !!exp.prototype?.start;
        instance = isClass ? new exp(meta) : exp(meta);
    } else instance = exp;
    if (!instance || typeof instance.start !== "function") throw new Error("Not a BetterDiscord plugin (no start function)");
    return { meta, instance, started: false };
}

export function startBD(name: string, code: string) {
    if (loaded.get(name)?.started) return loaded.get(name)!;
    let entry: Loaded;
    try {
        entry = loaded.get(name) ?? instantiate(code);
        loaded.set(name, entry);
        entry.instance.load?.();
        entry.instance.start();
        entry.started = true;
        entry.error = undefined;
    } catch (e) {
        entry = loaded.get(name) ?? { meta: parseMeta(code), instance: null, started: false };
        entry.error = String((e as Error)?.stack ?? e).slice(0, 600);
        loaded.set(name, entry);
        try { entry.instance?.stop?.(); } catch { }
        unpatchAll(entry.meta.name || name);
        console.error(`[BetterDiscord] ${name} failed to start`, e);
    }
    return entry;
}

export function stopBD(name: string) {
    const e = loaded.get(name);
    if (!e) return;
    try { if (e.started) e.instance?.stop?.(); } catch (err) { console.error(`[BetterDiscord] ${name} failed to stop`, err); }
    unpatchAll(e.meta.name || name);
    document.getElementById(`bd-style-${(e.meta.name || name).replace(/[^\w-]/g, "-")}`)?.remove();
    e.started = false;
}

export function setPluginsApi(api: typeof PluginsRef.api) { PluginsRef.api = api; }
