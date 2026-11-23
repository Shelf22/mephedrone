/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// BdApi.Patcher: before / instead / after monkey patches with clean removal, grouped by caller.

type Kind = "before" | "instead" | "after";
interface Child { id: number; caller: string; kind: Kind; cb: (...a: any[]) => any; }
interface Record { module: any; name: string; original: (...a: any[]) => any; children: Child[]; }

const records: Record[] = [];
let seq = 0;

function wrap(rec: Record) {
    const fn = function (this: any, ...args: any[]) {
        const kids = rec.children;
        for (const c of kids) if (c.kind === "before") { try { c.cb(this, args); } catch (e) { console.error(`[BD Patcher] ${c.caller} before failed`, e); } }
        let ret;
        const insteads = kids.filter(c => c.kind === "instead");
        if (!insteads.length) ret = rec.original.apply(this, args);
        else {
            // the last instead wins; each one gets the original (or the previous instead) to call
            let call = (...a: any[]) => rec.original.apply(this, a);
            for (const c of insteads) {
                const prev = call;
                call = (...a: any[]) => { try { return c.cb(this, a, prev); } catch (e) { console.error(`[BD Patcher] ${c.caller} instead failed`, e); return prev(...a); } };
            }
            ret = call(...args);
        }
        for (const c of kids) if (c.kind === "after") {
            try { const r = c.cb(this, args, ret); if (r !== undefined) ret = r; } catch (e) { console.error(`[BD Patcher] ${c.caller} after failed`, e); }
        }
        return ret;
    };
    Object.assign(fn, rec.original);
    try { Object.defineProperty(fn, "name", { value: rec.original.name }); } catch { }
    (fn as any).__originalFunction = rec.original;
    (fn as any).toString = () => rec.original.toString();
    return fn;
}

export function patch(caller: string, module: any, name: string, cb: (...a: any[]) => any, kind: Kind) {
    if (!module || typeof module[name] !== "function") {
        console.warn(`[BD Patcher] ${caller}: ${String(name)} is not a function on the given module`);
        return () => { };
    }
    let rec = records.find(r => r.module === module && r.name === name);
    if (!rec) {
        rec = { module, name, original: module[name], children: [] };
        records.push(rec);
        const wrapped = wrap(rec);
        try { module[name] = wrapped; } catch {
            try { Object.defineProperty(module, name, { value: wrapped, configurable: true, writable: true }); } catch (e) { console.error("[BD Patcher] can't patch", name, e); }
        }
    }
    const child: Child = { id: ++seq, caller, kind, cb };
    rec.children.push(child);
    const r = rec;
    return () => remove(r, child.id);
}

function remove(rec: Record, id: number) {
    rec.children = rec.children.filter(c => c.id !== id);
    if (!rec.children.length) {
        try { rec.module[rec.name] = rec.original; } catch { try { Object.defineProperty(rec.module, rec.name, { value: rec.original, configurable: true, writable: true }); } catch { } }
        records.splice(records.indexOf(rec), 1);
    }
}

export function unpatchAll(caller: string) {
    for (const rec of [...records]) for (const c of [...rec.children]) if (c.caller === caller) remove(rec, c.id);
}

export const getPatchesByCaller = (caller: string) => records.flatMap(r => r.children.filter(c => c.caller === caller).map(c => ({ ...c, module: r.module, functionName: r.name })));

export function makePatcher(bound?: string) {
    const who = (c: any) => bound ?? String(c);
    return bound
        ? {
            before: (m: any, n: string, cb: any) => patch(bound, m, n, cb, "before"),
            instead: (m: any, n: string, cb: any) => patch(bound, m, n, cb, "instead"),
            after: (m: any, n: string, cb: any) => patch(bound, m, n, cb, "after"),
            unpatchAll: () => unpatchAll(bound),
            getPatchesByCaller: () => getPatchesByCaller(bound),
        }
        : {
            before: (c: string, m: any, n: string, cb: any) => patch(who(c), m, n, cb, "before"),
            instead: (c: string, m: any, n: string, cb: any) => patch(who(c), m, n, cb, "instead"),
            after: (c: string, m: any, n: string, cb: any) => patch(who(c), m, n, cb, "after"),
            unpatchAll: (c: string) => unpatchAll(who(c)),
            getPatchesByCaller: (c: string) => getPatchesByCaller(who(c)),
        };
}
