/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Alerts, React, showToast, useEffect, useState } from "@webpack/common";

import { disableBD, enableBD, onBDChange, setOptIn, settings } from ".";
import { BD_CATALOG, BDEntry } from "./catalog";
import { loaded } from "./loader";

function SettingsPanel({ name }: { name: string; }) {
    const ref = React.useRef<HTMLDivElement>(null);
    const inst = loaded.get(name)?.instance;
    const panel = React.useMemo(() => { try { return inst?.getSettingsPanel?.(); } catch (e) { return String(e); } }, [inst]);
    useEffect(() => {
        if (panel instanceof Node && ref.current) { ref.current.replaceChildren(panel); }
    }, [panel]);
    if (!inst?.getSettingsPanel) return <div className="meph-bd-empty">This plugin has no settings.</div>;
    if (panel instanceof Node) return <div ref={ref} className="meph-bd-panel" />;
    if (typeof panel === "function") return <div className="meph-bd-panel">{React.createElement(panel)}</div>;
    if (React.isValidElement(panel)) return <div className="meph-bd-panel">{panel}</div>;
    return <div className="meph-bd-empty">{String(panel ?? "No settings")}</div>;
}

function Row({ e }: { e: BDEntry; }) {
    const on = !!settings.store.enabled[e.name];
    const l = loaded.get(e.name);
    const [open, setOpen] = useState(false);
    const status = !on ? "off" : l?.error ? "error" : l?.started ? "running" : "starting";
    return (
        <div className="meph-bd-row">
            <div className="meph-bd-row-main">
                <div className="meph-bd-meta">
                    <div className="meph-bd-name">{e.name} <span className={"meph-st-status " + status}>{status}</span></div>
                    <div className="meph-bd-desc">{e.description}</div>
                    <div className="meph-bd-by">v{e.version} · {e.author} · {e.license} · <a href={`https://github.com/${e.repo}`} target="_blank" rel="noreferrer">{e.repo}</a> · ✓ reviewed, SHA-256 {e.sha256.slice(0, 8)}…</div>
                </div>
                {on && l?.instance?.getSettingsPanel && <button className="meph-chip" onClick={() => setOpen(!open)}>{open ? "Close" : "Settings"}</button>}
                <button className={"meph-chip" + (on ? " on" : "")} disabled={!settings.store.optIn} onClick={async () => {
                    try { on ? disableBD(e) : await enableBD(e); } catch (err) { showToast({ text: `${e.name}: ${(err as Error).message}`, variant: "critical" }); }
                }}>{on ? "Disable" : "Enable"}</button>
            </div>
            {l?.error && on && <pre className="meph-st-errors">{l.error}</pre>}
            {open && on && <SettingsPanel name={e.name} />}
        </div>
    );
}

function BDPageInner() {
    const s = settings.use(["optIn", "enabled"]);
    const [q, setQ] = useState("");
    const [, force] = useState(0);
    useEffect(() => onBDChange(() => force(n => n + 1)), []);
    const ql = q.trim().toLowerCase();
    const shown = BD_CATALOG.filter(e => !ql || `${e.name} ${e.description} ${e.author}`.toLowerCase().includes(ql));
    const running = [...loaded.values()].filter(l => l.started).length;

    return (
        <div className="meph-bd">
            <div className={"meph-bd-optin" + (s.optIn ? " on" : "")}>
                <div>
                    <div className="meph-bd-optin-title">BetterDiscord plugins {s.optIn ? "are on" : "are off"}</div>
                    <div className="meph-bd-optin-text">
                        BetterDiscord plugins run <b>with full access</b> to Discord, unlike store plugins which are sandboxed.
                        Only the {BD_CATALOG.length} plugins below can run: each was reviewed for token theft, data leaks and remote code,
                        tested to start cleanly, and is pinned to an exact fingerprint so it can't change.
                    </div>
                </div>
                <button className={"meph-st-btn" + (s.optIn ? " off" : "")} onClick={() => {
                    if (s.optIn) return setOptIn(false);
                    Alerts.show({
                        title: "Turn on BetterDiscord plugins?",
                        body: "Plugins you enable here get full access to your Discord client. Only reviewed, fingerprint-pinned plugins are allowed, but no review is perfect. You can turn this off any time and everything stops immediately.",
                        confirmText: "Turn on", cancelText: "Cancel", onConfirm: () => setOptIn(true),
                    });
                }}>{s.optIn ? "Turn off" : "Turn on"}</button>
            </div>

            <div className="meph-bd-toolbar">
                <input className="meph-st-search" placeholder={`Search ${BD_CATALOG.length} verified BetterDiscord plugins`} value={q} onChange={e => setQ(e.currentTarget.value)} />
                <span className="meph-bd-count">{running} running</span>
            </div>
            <div className="meph-bd-list">{shown.map(e => <Row key={e.name} e={e} />)}</div>
        </div>
    );
}

export const BDPage = ErrorBoundary.wrap(BDPageInner, { noop: false });
