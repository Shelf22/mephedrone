/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { React } from "@webpack/common";

import { resolved, settings } from ".";
import { ACCENT_PRESETS, CornerId, CORNERS, FontId, FONTS, MephStyle, STYLES } from "./styles";

function Preview({ s, k }: { s: MephStyle; k: number; }) {
    const [bg, panel, text, accent] = s.preview;
    const r = (n: number) => `${n * k}px`;
    return (
        <div className="meph-prev" style={{ background: bg, borderRadius: r(10) }}>
            <div className="meph-prev-rail" style={{ background: panel }}>
                {[0, 1, 2].map(i => <i key={i} style={{ background: i ? text : accent, opacity: i ? 0.25 : 1, borderRadius: r(8) }} />)}
            </div>
            <div className="meph-prev-side" style={{ background: panel }}>
                {[70, 50, 60].map((w, i) => <i key={i} style={{ width: `${w}%`, background: text, opacity: i === 0 ? 0.7 : 0.25 }} />)}
            </div>
            <div className="meph-prev-chat">
                {[80, 55, 65].map((w, i) => <i key={i} style={{ width: `${w}%`, background: text, opacity: 0.35 }} />)}
                <b style={{ background: panel, borderRadius: r(6), boxShadow: `inset 0 0 0 1px ${accent}55` }}>
                    <span style={{ background: accent, borderRadius: r(3) }} />
                </b>
            </div>
        </div>
    );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode; }) {
    return (
        <div className="meph-row">
            <div className="meph-row-label">{label}{hint && <small>{hint}</small>}</div>
            <div className="meph-row-body">{children}</div>
        </div>
    );
}

function Chips<T extends string>({ value, options, onPick }: { value: T; options: [T, string][]; onPick(v: T): void; }) {
    return (
        <div className="meph-chips">
            {options.map(([v, label]) => (
                <button key={v || "default"} className={"meph-chip" + (v === value ? " on" : "")} onClick={() => onPick(v)}>{label}</button>
            ))}
        </div>
    );
}

function StylePageInner() {
    const s = settings.use(["style", "accent", "font", "corners", "effects", "darkness", "messages", "islands", "floatComposer", "motion"]);
    const r = resolved();

    return (
        <div className="meph-page">
            <div className="meph-styles">
                {STYLES.map(st => (
                    <button key={st.id} className={"meph-style-card" + (st.id === r.style.id ? " on" : "")} onClick={() => {
                        settings.store.style = st.id;
                        settings.store.accent = "";
                        settings.store.font = "";
                        settings.store.corners = "";
                        settings.store.darkness = 0;
                        settings.store.messages = "";
                        settings.store.islands = "";
                        settings.store.floatComposer = "";
                    }}>
                        <Preview s={st} k={CORNERS[st.corners]} />
                        <div className="meph-style-name">{st.name}</div>
                        <div className="meph-style-tag">{st.tagline}</div>
                    </button>
                ))}
            </div>

            <div className="meph-tweaks">
                <Row label="Accent" hint="buttons, links, toggles, highlights">
                    <div className="meph-swatches">
                        <button className={"meph-swatch default" + (!s.accent ? " on" : "")} title="Style default"
                            style={{ background: r.style.accent ?? "#5865f2" }} onClick={() => settings.store.accent = ""}>★</button>
                        {ACCENT_PRESETS.map(hex => (
                            <button key={hex} className={"meph-swatch" + (s.accent === hex ? " on" : "")} style={{ background: hex }}
                                onClick={() => settings.store.accent = hex} />
                        ))}
                        <label className={"meph-swatch custom" + (s.accent && !ACCENT_PRESETS.includes(s.accent) ? " on" : "")} title="Pick any colour"
                            style={{ background: s.accent && !ACCENT_PRESETS.includes(s.accent) ? s.accent : undefined }}>
                            +
                            <input type="color" value={r.accent ?? "#5865f2"} onChange={e => settings.store.accent = e.currentTarget.value} />
                        </label>
                    </div>
                </Row>

                <Row label="Motion" hint="animations everywhere">
                    <Chips<string> value={s.motion} onPick={v => settings.store.motion = v as any}
                        options={[["full", "Full ✨"], ["subtle", "Subtle"], ["off", "Off"]]} />
                </Row>

                <Row label="Messages" hint="how chat looks">
                    <Chips<string> value={s.messages} onPick={v => settings.store.messages = v}
                        options={[["", `Style default (${r.messages})`], ["bubbles", "Bubbles"], ["terminal", "Terminal lines"], ["classic", "Classic"]]} />
                </Row>

                <Row label="Layout" hint="panels and message box">
                    <Chips<string> value={s.islands === "" ? "" : s.islands ? "on" : "off"} onPick={v => settings.store.islands = (v === "" ? "" : v === "on") as any}
                        options={[["", `Default (${r.islands ? "islands" : "attached"})`], ["on", "Floating islands"], ["off", "Attached panels"]]} />
                    <Chips<string> value={s.floatComposer === "" ? "" : s.floatComposer ? "on" : "off"} onPick={v => settings.store.floatComposer = (v === "" ? "" : v === "on") as any}
                        options={[["", `Default (${r.floatComposer ? "floating" : "flat"} box)`], ["on", "Floating message box"], ["off", "Flat message box"]]} />
                </Row>

                <Row label="Font">
                    <Chips<string> value={s.font} onPick={v => settings.store.font = v}
                        options={[["", `Style default (${FONTS[r.style.font].label})`], ...(Object.entries(FONTS) as [FontId, { label: string; }][]).map(([id, f]) => [id, f.label] as [string, string])]} />
                </Row>

                <Row label="Corners">
                    <Chips<string> value={s.corners} onPick={v => settings.store.corners = v}
                        options={[["", "Style default"], ...(Object.keys(CORNERS) as CornerId[]).map(id => [id, id[0].toUpperCase() + id.slice(1)] as [string, string])]} />
                </Row>

                {r.style.neutral && (
                    <Row label="Darkness" hint="how dark the panels are">
                        <input className="meph-range" type="range" min={0.4} max={1.1} step={0.02}
                            value={s.darkness || r.style.neutral.darkScale}
                            onChange={e => settings.store.darkness = +e.currentTarget.value} />
                        <button className="meph-chip" onClick={() => settings.store.darkness = 0}>Reset</button>
                    </Row>
                )}

                <Row label="Effects" hint={r.style.id === "terminal" ? "scanlines + glow" : r.style.id === "glass" ? "background blur" : "style extras"}>
                    <Chips<string> value={s.effects ? "on" : "off"} onPick={v => settings.store.effects = v === "on"} options={[["on", "On"], ["off", "Off"]]} />
                </Row>
            </div>
        </div>
    );
}

export const StylePage = ErrorBoundary.wrap(StylePageInner, { noop: false });
