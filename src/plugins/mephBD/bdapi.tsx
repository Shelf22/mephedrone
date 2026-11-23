/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// BdApi for [MEPHEDRONE]: the BetterDiscord plugin API (modelled on BetterDiscord, Apache-2.0) built on Vencord internals.

import { addContextMenuPatch, removeContextMenuPatch } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import { Alerts, createRoot, Menu, React, ReactDOM, showToast, Tooltip } from "@webpack/common";

import { makePatcher } from "./patcher";
import { Webpack } from "./webpack";

export const BD_VERSION = "1.13.0";

// ReactDOM as plugins expect it: Discord's ReactDOM plus createRoot from react-dom/client
const BDReactDOM = new Proxy({} as any, {
    get: (_t, k) => k === "createRoot" ? createRoot : (ReactDOM as any)[k],
});
export { BDReactDOM };

// ---------- Data (synchronous for plugins, persisted in the background)
const DATA_KEY = "MephBDData";
let data: Record<string, Record<string, any>> = {};
let saveTimer: ReturnType<typeof setTimeout> | null = null;
export async function loadData() { data = await DataStore.get(DATA_KEY) ?? {}; }
const persist = () => { if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(() => DataStore.set(DATA_KEY, data), 400); };
const Data = {
    load: (plugin: string, key: string) => { const v = data[plugin]?.[key]; return v === undefined ? undefined : structuredClone(v); },
    save: (plugin: string, key: string, value: any) => { (data[plugin] ??= {})[key] = value === undefined ? undefined : JSON.parse(JSON.stringify(value)); persist(); },
    delete: (plugin: string, key: string) => { if (data[plugin]) { delete data[plugin][key]; persist(); } },
    recache: () => true,
};

// ---------- DOM
const styleId = (id: string) => `bd-style-${id.replace(/[^\w-]/g, "-")}`;
const DOM = {
    addStyle(id: string, css: string) {
        let el = document.getElementById(styleId(id)) as HTMLStyleElement | null;
        if (!el) { el = document.createElement("style"); el.id = styleId(id); document.head.appendChild(el); }
        el.textContent = css;
    },
    removeStyle: (id: string) => document.getElementById(styleId(id))?.remove(),
    injectScript: () => Promise.reject(new Error("Loading external scripts is disabled in [MEPHEDRONE]")),
    createElement(tag: string, options: Record<string, any> = {}, ...children: (Node | string)[]) {
        const el = document.createElement(tag);
        const { className, id, target, ...rest } = options;
        if (className) el.className = className;
        if (id) el.id = id;
        for (const [k, v] of Object.entries(rest)) { try { (el as any)[k] = v; } catch { el.setAttribute(k, String(v)); } }
        el.append(...children);
        if (target) (typeof target === "string" ? document.querySelector(target) : target)?.append(el);
        return el;
    },
    parseHTML(html: string, fragment = false) {
        const t = document.createElement("template");
        t.innerHTML = html;
        return fragment ? t.content : (t.content.childNodes.length === 1 ? t.content.firstChild : t.content);
    },
    escapeHTML: (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`),
    onRemoved(node: Node, cb: () => void) {
        const obs = new MutationObserver(() => { if (!document.contains(node)) { obs.disconnect(); cb(); } });
        obs.observe(document.body, { childList: true, subtree: true });
        return () => obs.disconnect();
    },
    animate: (update: (p: number) => void, duration: number) => {
        const start = performance.now();
        let raf = 0;
        const step = (t: number) => { const p = Math.min(1, (t - start) / duration); update(p); if (p < 1) raf = requestAnimationFrame(step); };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
    },
    get screenWidth() { return Math.max(document.documentElement.clientWidth, window.innerWidth); },
    get screenHeight() { return Math.max(document.documentElement.clientHeight, window.innerHeight); },
};

// ---------- Utils
const Utils = {
    findInTree(tree: any, filter: (n: any) => boolean, { walkable = null as string[] | null, ignore = [] as string[], maxDepth = 100 } = {}): any {
        const seen = new Set();
        const walk = (node: any, depth: number): any => {
            if (!node || typeof node !== "object" || seen.has(node) || depth > maxDepth) return undefined;
            seen.add(node);
            try { if (filter(node)) return node; } catch { }
            const keys = walkable ?? Object.keys(node);
            for (const k of keys) {
                if (ignore.includes(k)) continue;
                let v; try { v = node[k]; } catch { continue; }
                const r = walk(v, depth + 1);
                if (r !== undefined) return r;
            }
            return undefined;
        };
        try { if (filter(tree)) return tree; } catch { }
        return walk(tree, 0);
    },
    debounce<T extends (...a: any[]) => any>(fn: T, ms: number) { let t: any; return (...a: Parameters<T>) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; },
    escapeHTML: DOM.escapeHTML,
    className: (...a: any[]) => a.flat(Infinity).flatMap(x => !x ? [] : typeof x === "object" ? Object.entries(x).filter(([, v]) => v).map(([k]) => k) : [String(x)]).join(" "),
    extend(target: any, ...sources: any[]) {
        for (const s of sources) for (const k in s) {
            if (s[k] && typeof s[k] === "object" && !Array.isArray(s[k])) target[k] = Utils.extend(target[k] ?? {}, s[k]);
            else target[k] = s[k];
        }
        return target;
    },
    getNestedValue: (obj: any, path: string) => path.split(".").reduce((o, k) => o?.[k], obj),
    semverCompare(a: string, b: string) {
        const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
        for (let i = 0; i < 3; i++) { if ((pa[i] ?? 0) > (pb[i] ?? 0)) return -1; if ((pa[i] ?? 0) < (pb[i] ?? 0)) return 1; }
        return 0;
    },
};

// ---------- ReactUtils
const fiberOf = (node: any) => node && node[Object.keys(node).find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")) ?? ""];
const ReactUtils = {
    get rootInstance() { return fiberOf(document.getElementById("app-mount")?.firstElementChild); },
    getInternalInstance: fiberOf,
    getOwnerInstance(node: any, { include, exclude = ["Popout", "Tooltip", "Scroller", "BackgroundFlash"], filter = () => true } = {} as any) {
        let f = fiberOf(node);
        const name = (x: any) => x?.type?.displayName ?? x?.type?.name;
        while (f) {
            const inst = f.stateNode;
            if (inst && !(inst instanceof HTMLElement) && typeof inst === "object") {
                const n = name(f);
                if ((!include || include.includes(n)) && !exclude.includes(n) && filter(inst)) return inst;
            }
            f = f.return;
        }
        return null;
    },
    wrapElement(el: HTMLElement) { return () => React.createElement("div", { ref: (r: HTMLElement | null) => r && !r.contains(el) && r.appendChild(el) }); },
    wrapInHooks: (C: any) => C,
};

// ---------- UI
const TYPES: Record<string, "default" | "success" | "critical"> = { success: "success", error: "critical", danger: "critical", warn: "default", warning: "default", info: "default" };
const UI = {
    showToast: (text: string, opts: { type?: string; } = {}) => showToast({ text: String(text), variant: TYPES[opts.type ?? ""] ?? "default" }),
    alert: (title: string, content: any) => Alerts.show({ title, body: typeof content === "string" ? content : React.isValidElement(content) ? content : String(content), confirmText: "OK" }),
    showConfirmationModal(title: string, content: any, opts: { confirmText?: string; cancelText?: string; onConfirm?(): void; onCancel?(): void; danger?: boolean; } = {}) {
        Alerts.show({
            title, body: React.isValidElement(content) || typeof content === "string" ? content : Array.isArray(content) ? <>{content}</> : String(content),
            confirmText: opts.confirmText ?? "Okay", cancelText: opts.cancelText === null ? undefined : opts.cancelText ?? "Cancel",
            onConfirm: opts.onConfirm, onCancel: opts.onCancel,
        });
        return "bd-confirm";
    },
    showNotice: (content: string, opts: { type?: string; } = {}) => { UI.showToast(content, opts); return () => { }; },
    showNotification: (n: { title?: string; content?: string; type?: string; }) => UI.showToast([n.title, n.content].filter(Boolean).join(": "), n),
    createTooltip: (node: HTMLElement, content: string) => { node.title = String(content); return { show() { }, hide() { }, remove() { node.removeAttribute("title"); } }; },
    openDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
    showChangelogModal: () => "bd-changelog",
    buildSettingsPanel: ({ settings, onChange }: { settings: any[]; onChange?(category: string | null, id: string, value: any): void; }) => <BDSettings settings={settings} onChange={onChange} />,
};

function BDSettings({ settings, onChange, category = null }: { settings: any[]; onChange?: any; category?: string | null; }) {
    const [, force] = React.useState(0);
    const set = (s: any, v: any) => { s.value = v; onChange?.(category, s.id, v); s.onChange?.(v); force(n => n + 1); };
    return (
        <div className="meph-bd-settings">
            {settings.map(s => s.type === "category"
                ? <details key={s.id} open={!s.collapsed}><summary>{s.name}</summary><BDSettings settings={s.settings ?? []} onChange={onChange} category={s.id} /></details>
                : (
                    <label key={s.id} className="meph-bd-setting">
                        <span><b>{s.name}</b>{s.note && <small>{s.note}</small>}</span>
                        {s.type === "switch" ? <input type="checkbox" checked={!!s.value} disabled={s.disabled} onChange={e => set(s, e.currentTarget.checked)} />
                            : s.type === "dropdown" || s.type === "radio" ? <select value={s.value} disabled={s.disabled} onChange={e => set(s, s.options.find((o: any) => String(o.value) === e.currentTarget.value)?.value)}>{s.options?.map((o: any) => <option key={String(o.value)} value={String(o.value)}>{o.label ?? o.name}</option>)}</select>
                                : s.type === "slider" || s.type === "number" ? <input type={s.type === "slider" ? "range" : "number"} min={s.min} max={s.max} step={s.step} value={s.value} disabled={s.disabled} onChange={e => set(s, Number(e.currentTarget.value))} />
                                    : s.type === "color" ? <input type="color" value={s.value} disabled={s.disabled} onChange={e => set(s, e.currentTarget.value)} />
                                        : <input type="text" value={s.value ?? ""} placeholder={s.placeholder} disabled={s.disabled} onChange={e => set(s, e.currentTarget.value)} />}
                    </label>
                ))}
        </div>
    );
}

// ---------- ContextMenu
const cmPatches = new Map<string, Map<any, any>>();
function buildItem(props: any): any {
    const { type, id, label, action, items, children, checked, disabled, danger, ...rest } = props;
    const key = id ?? String(label);
    if (type === "separator") return <Menu.MenuSeparator key={key} />;
    if (type === "group") return <Menu.MenuGroup key={key}>{(items ?? children ?? []).map(buildItem)}</Menu.MenuGroup>;
    if (type === "toggle") return <Menu.MenuCheckboxItem key={key} id={key} label={label} checked={!!checked} disabled={disabled} action={action} />;
    if (type === "radio") return <Menu.MenuRadioItem key={key} id={key} label={label} checked={!!checked} disabled={disabled} action={action} group={rest.group ?? key} />;
    if (type === "submenu" || items || children?.length) return <Menu.MenuItem key={key} id={key} label={label} disabled={disabled}>{(items ?? children ?? []).map((i: any) => React.isValidElement(i) ? i : buildItem(i))}</Menu.MenuItem>;
    return <Menu.MenuItem key={key} id={key} label={label} action={action} disabled={disabled} color={danger ? "danger" : undefined} {...rest} />;
}
const ContextMenu = {
    patch(navId: string | string[], cb: (tree: any, props: any) => any) {
        const ids = Array.isArray(navId) ? navId : [navId];
        const unpatches = ids.map(id => {
            const wrapped = (children: any[], props: any) => {
                const tree = { props: { children }, type: "menu" };
                try { cb(tree, props); } catch (e) { console.error("[BD ContextMenu]", e); }
                if (tree.props.children !== children) children.splice(0, children.length, ...[tree.props.children].flat());
            };
            addContextMenuPatch(id, wrapped);
            (cmPatches.get(id) ?? cmPatches.set(id, new Map()).get(id)!).set(cb, wrapped);
            return () => { removeContextMenuPatch(id, wrapped); cmPatches.get(id)?.delete(cb); };
        });
        return () => unpatches.forEach(u => u());
    },
    unpatch(navId: string, cb: any) { const w = cmPatches.get(navId)?.get(cb); if (w) { removeContextMenuPatch(navId, w); cmPatches.get(navId)!.delete(cb); } },
    buildItem,
    buildMenuChildren: (items: any[]) => items.map(buildItem),
    buildMenu: (items: any[]) => (props: any) => <Menu.Menu navId="bd-menu" onClose={props?.onClose ?? (() => { })}>{items.map(buildItem)}</Menu.Menu>,
    open() { }, close() { },
    get Separator() { return Menu.MenuSeparator; }, get CheckboxItem() { return Menu.MenuCheckboxItem; }, get RadioItem() { return Menu.MenuRadioItem; },
    get Item() { return Menu.MenuItem; }, get Group() { return Menu.MenuGroup; }, get Menu() { return Menu.Menu; },
};

// ---------- Plugins registry (filled in by the loader)
export interface BDPluginApi { isEnabled(n: string): boolean; get(n: string): any; getAll(): any[]; enable(n: string): void; disable(n: string): void; toggle(n: string): void; reload(): void; folder: string; }
export const PluginsRef: { api: BDPluginApi; } = {
    api: { isEnabled: () => false, get: () => undefined, getAll: () => [], enable() { }, disable() { }, toggle() { }, reload() { }, folder: "" },
};

const Logger = {
    log: (n: string, ...a: any[]) => console.log(`%c[${n}]`, "color:#3ba55c;font-weight:700", ...a),
    info: (n: string, ...a: any[]) => console.info(`%c[${n}]`, "color:#3ba55c;font-weight:700", ...a),
    warn: (n: string, ...a: any[]) => console.warn(`[${n}]`, ...a),
    error: (n: string, ...a: any[]) => console.error(`[${n}]`, ...a),
    debug: (n: string, ...a: any[]) => console.debug(`[${n}]`, ...a),
};

const Net = { fetch: (url: string, opts?: RequestInit) => fetch(url, { credentials: "omit", ...opts }) };
const Components = {
    get Tooltip() { return Tooltip; },
    get Text() { return Vencord.Webpack.Common.Text; },
    get Button() { return Vencord.Webpack.Common.Button; },
    SettingsPanel: (p: any) => UI.buildSettingsPanel(p),
};

const statics = {
    get React() { return React; }, get ReactDOM() { return BDReactDOM; }, version: BD_VERSION,
    Webpack, Patcher: makePatcher(), Data, DOM, UI, Utils, ReactUtils, ContextMenu, Net, Logger, Components,
    get Plugins() { return PluginsRef.api; },
    Themes: { isEnabled: () => false, get: () => undefined, getAll: () => [], enable() { }, disable() { }, toggle() { }, reload() { }, folder: "" },
    Commands: { register: () => () => { }, unregister() { }, unregisterAll() { }, getCommandsByCaller: () => [] },
    Hooks: { useStateFromStores: (...a: any[]) => (Vencord.Webpack.Common as any).useStateFromStores(...a) },
    // pre-1.8 global helpers many plugins still call
    findModule: (f: any) => Webpack.getModule(f), findAllModules: (f: any) => Webpack.getModules(f),
    findModuleByProps: (...p: string[]) => Webpack.getByKeys(...p), findModuleByPrototypes: (...p: string[]) => Webpack.getByPrototypeKeys(...p),
    findModuleByDisplayName: (n: string) => Webpack.getByDisplayName(n),
    injectCSS: (id: string, css: string) => DOM.addStyle(id, css), clearCSS: (id: string) => DOM.removeStyle(id),
    loadData: Data.load, saveData: Data.save, deleteData: Data.delete, getData: Data.load, setData: Data.save,
    showToast: UI.showToast, alert: UI.alert, showConfirmationModal: UI.showConfirmationModal,
    getPlugin: (n: string) => PluginsRef.api.get(n)?.instance, isPluginEnabled: (n: string) => PluginsRef.api.isEnabled(n),
    monkeyPatch(module: any, method: string, opts: { before?: any; after?: any; instead?: any; displayName?: string; }) {
        const cbFor = (f: any) => (that: any, args: any[], ret?: any) => f({ thisObject: that, methodArguments: args, returnValue: ret, callOriginalMethod: () => module[method].__originalFunction?.apply(that, args) });
        const name = opts.displayName ?? "monkeyPatch";
        const P = makePatcher();
        const un = [opts.before && P.before(name, module, method, cbFor(opts.before)), opts.after && P.after(name, module, method, cbFor(opts.after)), opts.instead && P.instead(name, module, method, cbFor(opts.instead))].filter(Boolean);
        return () => un.forEach((u: any) => u());
    },
    suppressErrors: (fn: any) => (...a: any[]) => { try { return fn(...a); } catch (e) { console.error(e); } },
    testJSON: (s: string) => { try { return JSON.parse(s); } catch { return false; } },
};

/** `BdApi` as plugins see it: usable statically (BdApi.Webpack…) or as `new BdApi("PluginName")` with scoped Patcher/Data/DOM. */
export const BdApi: any = function BdApi(this: any, pluginName: string) {
    if (!(this instanceof BdApi)) return statics;
    const p = makePatcher(pluginName);
    return Object.assign(Object.create(statics), {
        Patcher: p,
        Data: { load: (k: string) => Data.load(pluginName, k), save: (k: string, v: any) => Data.save(pluginName, k, v), delete: (k: string) => Data.delete(pluginName, k), recache: () => true },
        DOM: { ...DOM, addStyle: (a: string, b?: string) => b === undefined ? DOM.addStyle(pluginName, a) : DOM.addStyle(a, b), removeStyle: (id?: string) => DOM.removeStyle(id ?? pluginName) },
        Logger: Object.fromEntries(Object.entries(Logger).map(([k, f]) => [k, (...a: any[]) => (f as any)(pluginName, ...a)])),
    });
};
for (const [k, v] of Object.entries(Object.getOwnPropertyDescriptors(statics))) Object.defineProperty(BdApi, k, v);
