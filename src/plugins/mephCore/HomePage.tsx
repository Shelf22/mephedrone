/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { setGhost, settings as privacy } from "@plugins/mephPrivacy";
import * as E2E from "@plugins/mephPrivacy/e2e";
import { lock } from "@plugins/mephPrivacy/lock";
import { privacyShields } from "@plugins/mephPrivacy/PrivacyPage";
import { blocked, onBlocked } from "@plugins/mephPrivacy/telemetry";
import { onStoreChange, state as store } from "@plugins/mephStore/catalog";
import { running } from "@plugins/mephStore/runtime";
import { BRAND, BRAND_LOGO } from "@shared/brand";
import { relaunch } from "@utils/native";
import { React, SettingsRouter, showToast, useEffect, UserStore, useState } from "@webpack/common";

import { resolved } from ".";

const go = (page: string) => SettingsRouter.openUserSettings(`${page}_panel`);

function Tile({ icon, value, label, sub, page }: { icon: string; value: React.ReactNode; label: string; sub?: string; page: string; }) {
    return (
        <button className="meph-home-tile" onClick={() => go(page)}>
            <div className="meph-home-tile-icon">{icon}</div>
            <div className="meph-home-tile-value">{value}</div>
            <div className="meph-home-tile-label">{label}</div>
            {sub && <div className="meph-home-tile-sub">{sub}</div>}
        </button>
    );
}

function HomePageInner() {
    const [, force] = useState(0);
    useEffect(() => onBlocked(() => force(n => n + 1)), []);
    useEffect(() => onStoreChange(() => force(n => n + 1)), []);
    const p = privacy.use(["ghost", "pin"]);
    const user = UserStore.getCurrentUser();
    const { score, total } = privacyShields();
    const r = resolved();
    const installed = Object.values(store.installed);
    const chats = E2E.lockedChannels().filter(c => c.on).length;

    return (
        <div className="meph-home">
            <div className="meph-home-hero">
                <img src={BRAND_LOGO} width={72} height={72} alt="" />
                <div className="meph-home-hero-text">
                    <div className="meph-home-title">{BRAND}</div>
                    <div className="meph-home-sub">Private, plugin-powered Discord{user ? ` · signed in as ${user.globalName ?? user.username}` : ""}</div>
                </div>
                <div className={"meph-home-shield" + (score >= 7 ? " good" : score >= 5 ? " ok" : " weak")}>
                    <b>{score}</b>/{total}
                    <span>{score >= 7 ? "Locked down" : score >= 5 ? "Protected" : "Gaps"}</span>
                </div>
            </div>

            <div className="meph-home-tiles">
                <Tile icon="🛡️" page="meph_privacy" value={`${score}/${total}`} label="Privacy" sub={`${blocked.count} tracking events blocked`} />
                <Tile icon="🔒" page="meph_privacy" value={chats} label="Encrypted chats" sub={chats ? "end-to-end" : "press 🔒 in a chat"} />
                <Tile icon="🧩" page="meph_store" value={installed.length} label="Store plugins" sub={`${running.size} running`} />
                <Tile icon="🎨" page="meph_style" value={<span className="meph-home-swatch" style={{ background: r.accent ?? "var(--brand-500)" }} />} label={r.style.name} sub={`${r.messages} messages`} />
            </div>

            <div className="meph-home-section">Quick actions</div>
            <div className="meph-home-actions">
                <button className={"meph-home-action" + (p.ghost ? " on" : "")} onClick={() => setGhost(!p.ghost).then(t => showToast({ text: t, variant: "success" }))}>
                    <span>👻</span>{p.ghost ? "Ghost mode on" : "Ghost mode"}
                </button>
                <button className="meph-home-action" onClick={() => p.pin ? lock() : go("meph_privacy")}>
                    <span>🔐</span>{p.pin ? "Lock now" : "Set up lock"}
                </button>
                <button className="meph-home-action" onClick={() => go("meph_store")}><span>🛍️</span>Browse store</button>
                <button className="meph-home-action" onClick={() => VencordNative.quickCss.openEditor()}><span>✏️</span>Custom CSS</button>
                {!IS_WEB && <button className="meph-home-action" onClick={relaunch}><span>🔄</span>Restart client</button>}
            </div>

            <div className="meph-home-section">What's protecting you</div>
            <ul className="meph-home-list">
                <li><b>Telemetry</b> {privacy.store.blockTelemetry ? "blocked" : "allowed"}: Discord's analytics and crash reports {privacy.store.blockTelemetry ? "never leave your PC" : "are being sent"}.</li>
                <li><b>Link safety</b> {privacy.store.warnLinks ? "on" : "off"}: IP loggers, fake Discord/Steam sites and login-QR scams get flagged.</li>
                <li><b>Photos</b> {privacy.store.stripMetadata ? "cleaned" : "not cleaned"}: GPS location and camera info {privacy.store.stripMetadata ? "are removed before upload" : "stay in your uploads"}.</li>
                <li><b>Store plugins</b> run sandboxed: they never see your token and only get the permissions you approved.</li>
            </ul>
        </div>
    );
}

export const HomePage = ErrorBoundary.wrap(HomePageInner, { noop: false });
