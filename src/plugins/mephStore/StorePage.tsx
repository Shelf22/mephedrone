/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { IconProps } from "@utils/types";
import { Alerts, React, showToast, useEffect, useMemo, useState } from "@webpack/common";

import { BUILTIN_SOURCE, hasUpdate, install, loadCatalogs, newPermissions, onStoreChange, setEnabled, setSetting, SourceResult, state, uninstall } from "./catalog";
import { defaultsWith, onRuntimeChange, running } from "./runtime";
import { CatalogEntry, Installed, Permission, PERMISSION_INFO } from "./types";

export const StoreIcon = ({ width = 20, height = 20, className }: IconProps) => (
    <svg width={width} height={height} className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M4 7h16l-1.2 12.1A2 2 0 0 1 16.8 21H7.2a2 2 0 0 1-2-1.9ZM8 7V6a4 4 0 0 1 8 0v1h-2V6a2 2 0 0 0-4 0v1Z" />
    </svg>
);

function PermList({ perms, network, only }: { perms: Permission[]; network?: string[]; only?: string[]; }) {
    return (
        <ul className="meph-st-perms">
            {perms.filter(p => !only || only.includes(p) || (p === "network" && only.some(o => o.startsWith("net:")))).map(p => (
                <li key={p} className={PERMISSION_INFO[p]?.risky ? "risky" : ""}>
                    <span>{PERMISSION_INFO[p]?.icon ?? "❔"}</span>
                    {PERMISSION_INFO[p]?.label ?? p}
                    {p === "network" && network?.length ? <code>{network.join(", ")}</code> : null}
                </li>
            ))}
        </ul>
    );
}

function confirmInstall(e: CatalogEntry, update: boolean) {
    const added = update ? newPermissions(e) : null;
    return new Promise<boolean>(resolve => Alerts.show({
        title: `${update ? "Update" : "Install"} ${e.icon ?? "🧩"} ${e.name}?`,
        body: (
            <div className="meph-st-confirm">
                <p>by <b>{e.author}</b> · v{e.version} · from {e.source === BUILTIN_SOURCE ? "the built-in catalog" : new URL(e.source!).hostname}</p>
                {update && !added?.length
                    ? <p>No new permissions.</p>
                    : <>
                        <p>{update ? "This update asks for new permissions:" : "This plugin will be able to:"}</p>
                        <PermList perms={e.permissions} network={e.network} only={added ?? undefined} />
                    </>}
                <p className="meph-st-fine">It runs isolated from Discord: it can't see your token, your other chats or anything not listed here. Its code is checked against the store's SHA-256 fingerprint.</p>
            </div>
        ),
        confirmText: update ? "Update" : "Install",
        cancelText: "Cancel",
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
        onCloseCallback: () => resolve(false),
    }));
}

async function doInstall(e: CatalogEntry) {
    const update = !!state.installed[e.id];
    if (!await confirmInstall(e, update)) return;
    try {
        await install(e);
        showToast({ text: `${e.name} ${update ? "updated" : "installed"}`, variant: "success" });
    } catch (err) {
        showToast({ text: (err as Error).message, variant: "critical" });
    }
}

function Card({ e }: { e: CatalogEntry; }) {
    const inst = state.installed[e.id];
    const upd = hasUpdate(e);
    return (
        <div className="meph-st-card">
            <div className="meph-st-card-top">
                <div className="meph-st-icon">{e.icon ?? "🧩"}</div>
                <div className="meph-st-meta">
                    <div className="meph-st-name">{e.name}</div>
                    <div className="meph-st-by">{e.author} · v{e.version}{e.category ? ` · ${e.category}` : ""}</div>
                </div>
                {inst && !upd
                    ? <span className="meph-st-badge">Installed</span>
                    : <button className="meph-st-btn" onClick={() => doInstall(e)}>{upd ? "Update" : "Install"}</button>}
            </div>
            <div className="meph-st-desc">{e.description}</div>
            <div className="meph-st-chips">
                {e.permissions.map(p => <span key={p} className={"meph-st-chip" + (PERMISSION_INFO[p]?.risky ? " risky" : "")} title={PERMISSION_INFO[p]?.label}>{PERMISSION_INFO[p]?.icon} {p}</span>)}
            </div>
        </div>
    );
}

function SettingsForm({ p }: { p: Installed; }) {
    const values = defaultsWith(p);
    const defs = Object.entries(p.manifest.settings ?? {});
    if (!defs.length) return <div className="meph-st-nosettings">No settings.</div>;
    return (
        <div className="meph-st-form">
            {defs.map(([k, d]) => (
                <label key={k}>
                    <span>{d.label}</span>
                    {d.type === "boolean"
                        ? <input type="checkbox" checked={!!values[k]} onChange={ev => setSetting(p.manifest.id, k, ev.currentTarget.checked)} />
                        : d.type === "select"
                            ? <select value={values[k]} onChange={ev => setSetting(p.manifest.id, k, ev.currentTarget.value)}>
                                {d.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                            : <input type="text" defaultValue={values[k]} onBlur={ev => setSetting(p.manifest.id, k, ev.currentTarget.value)} />}
                </label>
            ))}
        </div>
    );
}

function InstalledRow({ p }: { p: Installed; }) {
    const [open, setOpen] = useState(false);
    const r = running.get(p.manifest.id);
    const status = !p.enabled ? "off" : r?.errors.length ? "error" : r ? "running" : "starting";
    return (
        <div className="meph-st-row">
            <div className="meph-st-row-main">
                <div className="meph-st-icon small">{p.manifest.icon ?? "🧩"}</div>
                <div className="meph-st-meta">
                    <div className="meph-st-name">{p.manifest.name} <span className={"meph-st-status " + status}>{status}</span></div>
                    <div className="meph-st-by">v{p.manifest.version} · ✓ verified {p.sha256.slice(0, 10)}… · {p.source === BUILTIN_SOURCE ? "built-in catalog" : new URL(p.source).hostname}</div>
                </div>
                <button className="meph-chip" onClick={() => setOpen(!open)}>{open ? "Close" : "Settings"}</button>
                <button className="meph-chip" onClick={() => setEnabled(p.manifest.id, !p.enabled)}>{p.enabled ? "Disable" : "Enable"}</button>
                <button className="meph-chip danger" onClick={() => Alerts.show({
                    title: `Remove ${p.manifest.name}?`, body: "Its settings and saved data are deleted too.",
                    confirmText: "Remove", cancelText: "Cancel", onConfirm: () => uninstall(p.manifest.id),
                })}>Remove</button>
            </div>
            {open && <div className="meph-st-row-more">
                <PermList perms={p.manifest.permissions} network={p.manifest.network} />
                <SettingsForm p={p} />
                {r?.errors.length ? <pre className="meph-st-errors">{r.errors.join("\n")}</pre> : null}
            </div>}
        </div>
    );
}

function Sources({ results, reload }: { results: SourceResult[]; reload(): void; }) {
    const [url, setUrl] = useState("");
    return (
        <div className="meph-st-sources">
            <p className="meph-st-fine">A source is a store index (an <code>index.json</code> file, e.g. on GitHub). Only add sources you trust: plugins are sandboxed and permission-checked, but a source decides what's offered.</p>
            {results.map(s => (
                <div key={s.source} className="meph-st-row-main">
                    <div className="meph-st-meta">
                        <div className="meph-st-name">{s.name}</div>
                        <div className="meph-st-by">{s.source === BUILTIN_SOURCE ? "Ships with the client, works offline" : s.source} · {s.error ? <span className="meph-st-err">⚠ {s.error}</span> : `${s.entries.length} plugins`}</div>
                    </div>
                    {s.source !== BUILTIN_SOURCE && <button className="meph-chip danger" onClick={() => { state.sources = state.sources.filter(x => x !== s.source); reload(); }}>Remove</button>}
                </div>
            ))}
            <form className="meph-st-add" onSubmit={ev => {
                ev.preventDefault();
                try {
                    const u = new URL(url.trim());
                    if (u.protocol !== "https:") throw new Error();
                    if (!state.sources.includes(u.href)) state.sources.push(u.href);
                    setUrl("");
                    reload();
                } catch { showToast({ text: "Enter an https:// link to an index.json", variant: "critical" }); }
            }}>
                <input placeholder="https://raw.githubusercontent.com/…/index.json" value={url} onChange={e => setUrl(e.currentTarget.value)} />
                <button className="meph-chip on" type="submit">Add source</button>
            </form>
        </div>
    );
}

function StorePageInner() {
    const [tab, setTab] = useState<"browse" | "installed" | "sources">("browse");
    const [q, setQ] = useState("");
    const [cat, setCat] = useState("All");
    const [results, setResults] = useState<SourceResult[]>([]);
    const [loading, setLoading] = useState(true);
    const [, force] = useState(0);

    const reload = () => { setLoading(true); loadCatalogs().then(r => { setResults(r); setLoading(false); }); };
    useEffect(reload, []);
    useEffect(() => onStoreChange(() => force(n => n + 1)), []);
    useEffect(() => onRuntimeChange(() => force(n => n + 1)), []);

    const all = useMemo(() => {
        const seen = new Map<string, CatalogEntry>();
        for (const s of results) for (const e of s.entries) if (!seen.has(e.id)) seen.set(e.id, e);
        return [...seen.values()];
    }, [results]);
    const cats = ["All", ...new Set(all.map(e => e.category ?? "Other"))];
    const ql = q.trim().toLowerCase();
    const shown = all.filter(e => (cat === "All" || (e.category ?? "Other") === cat)
        && (!ql || `${e.name} ${e.description} ${e.author}`.toLowerCase().includes(ql)));
    const installed = Object.values(state.installed);
    const updates = all.filter(hasUpdate).length;

    return (
        <div className="meph-st">
            <div className="meph-st-tabs">
                {([["browse", "Browse"], ["installed", `Installed (${installed.length})`], ["sources", "Sources"]] as const).map(([k, l]) => (
                    <button key={k} className={"meph-st-tab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{l}{k === "installed" && updates ? <i>{updates}</i> : null}</button>
                ))}
            </div>

            {tab === "browse" && <>
                <div className="meph-st-toolbar">
                    <input className="meph-st-search" placeholder="Search plugins" value={q} onChange={e => setQ(e.currentTarget.value)} />
                    <div className="meph-chips">{cats.map(c => <button key={c} className={"meph-chip" + (c === cat ? " on" : "")} onClick={() => setCat(c)}>{c}</button>)}</div>
                </div>
                {loading ? <div className="meph-st-empty">Loading store…</div>
                    : shown.length ? <div className="meph-st-grid">{shown.map(e => <Card key={e.id} e={e} />)}</div>
                        : <div className="meph-st-empty">Nothing matches.</div>}
            </>}

            {tab === "installed" && (installed.length
                ? <div className="meph-st-list">{installed.map(p => <InstalledRow key={p.manifest.id} p={p} />)}</div>
                : <div className="meph-st-empty">No store plugins yet. Find some under Browse.</div>)}

            {tab === "sources" && <Sources results={results} reload={() => { reload(); }} />}
        </div>
    );
}

export const StorePage = ErrorBoundary.wrap(StorePageInner, { noop: false });
