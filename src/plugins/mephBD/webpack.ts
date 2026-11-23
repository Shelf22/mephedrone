/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// BdApi.Webpack on top of Vencord's webpack cache. Mirrors BetterDiscord's API (Apache-2.0) behaviour:
// filters get (exports, module, id); options first / defaultExport / searchExports / searchDefault / raw.

import { cache, fluxStores, waitFor } from "@webpack";

type Filter = (exports: any, module?: any, id?: string) => boolean;
interface Opts { first?: boolean; defaultExport?: boolean; searchExports?: boolean; searchDefault?: boolean; raw?: boolean; fatal?: boolean; }

const safe = (f: Filter): Filter => (e, m, i) => { try { return !!f(e, m, i); } catch { return false; } };
const isObj = (x: any) => x != null && (typeof x === "object" || typeof x === "function");
// Some exports (e.g. Discord's i18n messagesLoader) are proxies that claim to have every property;
// they'd match any key-based search, so they're skipped like real BetterDiscord does.
const claimsEverything = (x: any) => { try { return "__meph_no_such_key__" in x || x.__meph_no_such_key__ !== undefined; } catch { return true; } };
const usable = (x: any) => isObj(x) && !BLOCKED.has(x) && !claimsEverything(x);
const BLOCKED = new Set<any>([window, document, document.documentElement]);

function* candidates(opts: Opts) {
    const { defaultExport = true, searchExports = false, searchDefault = true } = opts;
    for (const id in cache) {
        const mod = cache[id];
        const exp = mod?.exports;
        if (!usable(exp)) continue;
        yield { value: exp, mod, id, raw: exp };
        if (searchDefault && exp.default && usable(exp.default) && defaultExport)
            yield { value: exp.default, mod, id, raw: exp };
        // Discord's ES modules export under mangled names (Z, ZP, A, Ay…) rather than "default";
        // BetterDiscord treats those like default exports, so look one level into them too.
        if (searchExports || (searchDefault && defaultExport && typeof exp === "object" && !Array.isArray(exp))) {
            for (const key in exp) {
                let v; try { v = exp[key]; } catch { continue; }
                if (usable(v)) yield { value: v, mod, id, raw: exp, key };
            }
        }
    }
}

export function getModule(filter: Filter, opts: Opts = {}) {
    const f = safe(filter);
    const { first = true, raw = false } = opts;
    const out: any[] = [];
    for (const c of candidates(opts)) {
        if (!f(c.value, c.mod, c.id)) continue;
        const v = raw ? c.mod : c.value;
        if (first) return v;
        if (!out.includes(v)) out.push(v);
    }
    return first ? undefined : out;
}

const keysFilter = (keys: string[]) => (e: any) => isObj(e) && keys.every(k => k in e);
const protoFilter = (keys: string[]) => (e: any) => typeof e === "function" && e.prototype && keys.every(k => k in e.prototype);
const fnSource = (e: any) => { try { return Function.prototype.toString.call(e); } catch { return ""; } };
const stringsFilter = (strs: string[]) => (e: any) => {
    if (typeof e !== "function") {
        if (typeof e?.render === "function") e = e.render;
        else if (typeof e?.type === "function") e = e.type;
        else return false;
    }
    const s = fnSource(e);
    return strs.every(x => s.includes(x));
};
const sourceFilter = (...match: (string | RegExp)[]) => (_e: any, m: any, id?: string) => {
    const factory = (window as any).webpackChunkdiscord_app && id ? Vencord.Webpack.wreq.m[id] : null;
    const src = factory ? fnSource(factory) : "";
    return !!src && match.every(x => typeof x === "string" ? src.includes(x) : x.test(src));
};

export const Filters = {
    byKeys: (...keys: string[]) => keysFilter(keys.flat()),
    byProps: (...keys: string[]) => keysFilter(keys.flat()),
    byPrototypeKeys: (...keys: string[]) => protoFilter(keys.flat()),
    byPrototypeFields: (...keys: string[]) => protoFilter(keys.flat()),
    byStrings: (...strs: string[]) => stringsFilter(strs.flat()),
    bySource: sourceFilter,
    byRegex: (re: RegExp) => (e: any) => typeof e === "function" && re.test(fnSource(e)),
    byDisplayName: (name: string) => (e: any) => e?.displayName === name || e?.render?.displayName === name,
    byStoreName: (name: string) => (e: any) => e?._dispatchToken && (e.getName?.() === name || e.constructor?.displayName === name),
    combine: (...fs: Filter[]) => (e: any, m: any, i: any) => fs.every(f => f(e, m, i)),
    not: (f: Filter) => (e: any, m: any, i: any) => !f(e, m, i),
};

const withExports = (opts: Opts = {}) => ({ searchExports: true, ...opts });

export const Webpack = {
    Filters,
    getModule,
    getModules: (filter: Filter, opts: Opts = {}) => getModule(filter, { ...opts, first: false }),
    getBulkKeyed(queries: Record<string, { filter: Filter; } & Opts>) {
        return Object.fromEntries(Object.entries(queries).map(([k, q]) => [k, getModule(q.filter, q)]));
    },
    getBulk(...queries: Array<{ filter: Filter; } & Opts>) {
        return queries.map(q => getModule(q.filter, q));
    },
    getByKeys: (...args: any[]) => { const o = isObj(args.at(-1)) && !Array.isArray(args.at(-1)) ? args.pop() : {}; return getModule(Filters.byKeys(...args), o); },
    getByProps: (...props: string[]) => getModule(Filters.byKeys(...props)),
    getAllByKeys: (...args: any[]) => { const o = isObj(args.at(-1)) && !Array.isArray(args.at(-1)) ? args.pop() : {}; return getModule(Filters.byKeys(...args), { ...o, first: false }); },
    getByPrototypeKeys: (...args: any[]) => { const o = isObj(args.at(-1)) && !Array.isArray(args.at(-1)) ? args.pop() : {}; return getModule(Filters.byPrototypeKeys(...args), withExports(o)); },
    getByStrings: (...args: any[]) => { const o = isObj(args.at(-1)) && !Array.isArray(args.at(-1)) ? args.pop() : {}; return getModule(Filters.byStrings(...args), withExports(o)); },
    getAllByStrings: (...args: any[]) => { const o = isObj(args.at(-1)) && !Array.isArray(args.at(-1)) ? args.pop() : {}; return getModule(Filters.byStrings(...args), { ...withExports(o), first: false }); },
    getBySource: (...args: any[]) => { const o = isObj(args.at(-1)) && !(args.at(-1) instanceof RegExp) && typeof args.at(-1) !== "string" ? args.pop() : {}; return getModule(sourceFilter(...args), o); },
    getByRegex: (re: RegExp, opts: Opts = {}) => getModule(Filters.byRegex(re), withExports(opts)),
    getByDisplayName: (name: string) => getModule(Filters.byDisplayName(name), withExports()),
    getStore(name: string) {
        for (const s of fluxStores.values()) if ((s as any).getName?.() === name || (s as any).constructor?.displayName === name) return s;
        return getModule(Filters.byStoreName(name));
    },
    getWithKey(filter: Filter, opts: Opts = {}) {
        const f = safe(filter);
        for (const c of candidates({ ...opts, searchExports: true })) if (c.key && f(c.value)) return [c.raw, c.key];
        return [undefined, undefined];
    },
    getMangled(filter: Filter | string, mappers: Record<string, Filter>, opts: Opts = {}) {
        const mod = typeof filter === "function" ? getModule(filter, { ...opts, raw: false }) : getModule(sourceFilter(filter), { raw: true })?.exports;
        const out: Record<string, any> = {};
        if (!mod) return out;
        for (const [k, f] of Object.entries(mappers)) for (const key in mod) { try { if (f(mod[key])) { out[k] = mod[key]; break; } } catch { } }
        return out;
    },
    waitForModule(filter: Filter, opts: Opts & { signal?: AbortSignal; } = {}) {
        return new Promise(resolve => {
            const existing = getModule(filter, opts);
            if (existing) return resolve(existing);
            waitFor(e => safe(filter)(e), resolve);
        });
    },
    get modules() { return Vencord.Webpack.wreq.m; },
    /** BdApi.Webpack.Stores.UserStore etc. */
    Stores: new Proxy({} as Record<string, any>, {
        get: (_t, name) => typeof name === "string" ? Webpack.getStore(name) : undefined,
        has: (_t, name) => typeof name === "string" && !!Webpack.getStore(name),
        ownKeys: () => [...fluxStores.keys()],
        getOwnPropertyDescriptor: (_t, name) => ({ configurable: true, enumerable: true, value: typeof name === "string" ? Webpack.getStore(name) : undefined }),
    }),
    require: (id: string) => Vencord.Webpack.wreq(id as any),
};
