/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { Settings, useSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { ChannelStore, GuildStore, React, showToast, useEffect, UserStore, useState } from "@webpack/common";

import { ensurePlugin, LockIcon, openKeyModal, setGhost, settings } from ".";
import * as E2E from "./e2e";
import { hashPin, lock } from "./lock";
import { settings as locSettings } from "@plugins/mephLocation";
import { current as currentPlaceRaw, PLACES } from "@plugins/mephLocation/location";

import { embedStats } from "./embeds";

const currentPlace = () => currentPlaceRaw;
import { blocked, onBlocked } from "./telemetry";
import { ipGuardStats } from "./voice";

function Toggle({ on, onChange, title, desc }: { on: boolean; onChange(v: boolean): void; title: string; desc?: React.ReactNode; }) {
    return (
        <div className="meph-pv-row" onClick={() => onChange(!on)}>
            <div className="meph-pv-text">
                <div className="meph-pv-title">{title}</div>
                {desc && <div className="meph-pv-desc">{desc}</div>}
            </div>
            <div className={"meph-switch" + (on ? " on" : "")} role="switch" aria-checked={on}><i /></div>
        </div>
    );
}

function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode; }) {
    return (
        <section className="meph-pv-section">
            <h3><span>{icon}</span>{title}</h3>
            <div className="meph-pv-card">{children}</div>
        </section>
    );
}

function chatName(id: string) {
    const c = ChannelStore.getChannel(id);
    if (!c) return "Unknown chat";
    if (c.guild_id) return `#${c.name} · ${GuildStore.getGuild(c.guild_id)?.name ?? "server"}`;
    if (c.name) return c.name;
    const u = c.recipients?.[0] ? UserStore.getUser(c.recipients[0]) : null;
    return u ? `@${u.globalName ?? u.username}` : "DM";
}

function PinSetup() {
    const { pin } = settings.use(["pin"]);
    const [a, setA] = useState("");
    const [b, setB] = useState("");
    if (pin) return (
        <div className="meph-pv-pin">
            <span className="meph-pv-ok">PIN is set</span>
            <button className="meph-chip" onClick={() => lock()}>Lock now</button>
            <button className="meph-chip" onClick={() => { settings.store.pin = ""; showToast({ text: "PIN removed, lock screen off", variant: "success" }); }}>Remove PIN</button>
        </div>
    );
    return (
        <form className="meph-pv-pin" onSubmit={async e => {
            e.preventDefault();
            if (a.length < 4) return showToast({ text: "Use at least 4 characters", variant: "critical" });
            if (a !== b) return showToast({ text: "The two entries don't match", variant: "critical" });
            settings.store.pin = await hashPin(a);
            setA(""); setB("");
            showToast({ text: "PIN set. Ctrl+Shift+L locks instantly.", variant: "success" });
        }}>
            <input type="password" placeholder="New PIN or password" value={a} onChange={e => setA(e.currentTarget.value)} />
            <input type="password" placeholder="Again" value={b} onChange={e => setB(e.currentTarget.value)} />
            <button className="meph-chip on" type="submit">Set PIN</button>
        </form>
    );
}

export function privacyShields() {
    const s = settings.store;
    const anon = Settings.plugins.AnonymiseFileNames;
    const shields = [
        s.blockTelemetry, s.warnLinks, s.cleanOpenedLinks, isPluginEnabled("ClearURLs"), s.stripMetadata,
        anon?.anonymiseByDefault !== false, !!s.pin, E2E.lockedChannels().some(c => c.on),
    ];
    return { score: shields.filter(Boolean).length, total: shields.length };
}

function LocationSection() {
    const loc = locSettings.use(["mode", "fixedCity"]);
    const cur = currentPlace();
    const modeLabel = { random: "New random city every startup", fixed: "Always the same city", off: "Off (send real timezone)" } as const;
    return (
        <Section icon="📍" title="Location">
            <div className="meph-pv-note">
                {loc.mode === "off" || !cur
                    ? <>Discord currently gets your <b>real timezone</b> and system locale from this client.</>
                    : <>Discord thinks you're in <b>{cur.city}</b> ({cur.tz}). It gets that timezone in request headers and your account settings, a generic locale (en-US), and those coordinates if anything asks for your location. Times shown to you stay in your real timezone.</>}
                {" "}<b>Your IP address</b> still reveals your rough location to Discord's servers. No client can change that, only a VPN can.
            </div>
            <div className="meph-pv-row static">
                <div className="meph-pv-text"><div className="meph-pv-title">Spoof location</div><div className="meph-pv-desc">Changes apply on the next startup.</div></div>
                <div className="meph-chips">
                    {(["random", "fixed", "off"] as const).map(m => (
                        <button key={m} className={"meph-chip" + (loc.mode === m ? " on" : "")} onClick={() => locSettings.store.mode = m}>{modeLabel[m]}</button>
                    ))}
                </div>
            </div>
            {loc.mode === "fixed" && (
                <div className="meph-pv-row static">
                    <div className="meph-pv-text"><div className="meph-pv-title">City</div></div>
                    <select className="meph-pv-select" value={loc.fixedCity} onChange={e => locSettings.store.fixedCity = e.currentTarget.value}>
                        {PLACES.map(p => <option key={p.city} value={p.city}>{p.city} ({p.tz})</option>)}
                    </select>
                </div>
            )}
        </Section>
    );
}

function PrivacyPageInner() {
    const s = settings.use();
    useSettings(["plugins.SilentTyping.isEnabled", "plugins.AnonymiseFileNames.anonymiseByDefault", "plugins.ClearURLs.enabled"] as any);
    const [, force] = useState(0);
    useEffect(() => onBlocked(() => force(n => n + 1)), []);
    const chats = E2E.lockedChannels();
    const typing = Settings.plugins.SilentTyping;
    const anon = Settings.plugins.AnonymiseFileNames;

    const shields = [
        s.blockTelemetry, s.warnLinks, s.cleanOpenedLinks, isPluginEnabled("ClearURLs"), s.stripMetadata,
        anon?.anonymiseByDefault !== false, !!s.pin, chats.some(c => c.on),
    ];
    const score = shields.filter(Boolean).length;

    return (
        <div className="meph-pv">
            <div className="meph-pv-hero">
                <div className="meph-pv-score"><b>{score}</b>/{shields.length}</div>
                <div>
                    <div className="meph-pv-hero-title">{score >= 7 ? "Locked down" : score >= 5 ? "Well protected" : "Some protections are off"}</div>
                    <div className="meph-pv-hero-sub">
                        {blocked.count} tracking event{blocked.count === 1 ? "" : "s"} blocked this session
                        {Object.keys(blocked.byType).length ? ` (${Object.entries(blocked.byType).map(([k, v]) => `${v} ${k}`).join(", ")})` : ""}
                    </div>
                </div>
            </div>

            <Section icon="🛰️" title="Anti-tracking">
                <Toggle on={s.blockTelemetry} onChange={v => settings.store.blockTelemetry = v} title="Block Discord telemetry"
                    desc="Drops analytics, metrics and crash reports before they leave your PC. The Rust app also never scans your running programs." />
                <Toggle on={isPluginEnabled("ClearURLs")} onChange={v => v ? ensurePlugin("ClearURLs") : showToast({ text: "Turn it off in Plugins if you really want to", variant: "default" })}
                    title="Strip trackers from links you send" desc="Removes utm_, fbclid, si= and similar from links before they're posted." />
                <Toggle on={s.cleanOpenedLinks} onChange={v => settings.store.cleanOpenedLinks = v} title="Strip trackers from links you open" />
                <Toggle on={!s.allowBadgeLists} onChange={v => settings.store.allowBadgeLists = !v} title="Don't download contributor badge lists"
                    desc="Vencord and Equicord fetch their donor/contributor badge lists from their own servers at every start, which shows them your IP. Off = you won't see those badges on profiles. Takes effect after a restart." />
                <Toggle on={s.warnLinks} onChange={v => settings.store.warnLinks = v} title="Warn about dangerous links"
                    desc="IP loggers (Grabify and its disguises), fake Discord/Steam sites and Discord login-QR links get a warning before they open and a red label in chat." />
            </Section>

            <LocationSection />

            <Section icon="🎙️" title="Voice & video">
                <Toggle on={s.voiceIpGuard} onChange={v => settings.store.voiceIpGuard = v} title="Never send my local network address in calls"
                    desc={<>Safety net: if Discord's voice connection ever tries to share your home-network IP (like 192.168.x.x), it's stripped out. Checked 2026-11: Discord currently doesn't send it, and other users never get your IP from voice. {ipGuardStats.stripped ? `${ipGuardStats.stripped} local addresses hidden so far.` : ""}</>} />
                <Toggle on={s.callSecurityBadge} onChange={v => settings.store.callSecurityBadge = v} title="Show call encryption status"
                    desc="A badge above your user panel shows whether the current call is end-to-end encrypted, and warns you when it isn't." />
                <Toggle on={s.confirmVoiceJoin} onChange={v => settings.store.confirmVoiceJoin = v} title="Confirm before joining voice" desc="No more accidental joins that announce you to the server." />
                <Toggle on={s.muteOnJoin} onChange={v => settings.store.muteOnJoin = v} title="Join calls muted" desc="Your mic stays off until you unmute." />
            </Section>

            <Section icon="🖼️" title="Embeds">
                <Toggle on={s.embedGuard} onChange={v => settings.store.embedGuard = v} title="Click-to-load third-party players"
                    desc={<>Spotify, SoundCloud and other player embeds load straight from those companies (your IP + their trackers). They now wait for a click. Images and link previews already go through Discord's proxy. {embedStats.blocked ? `${embedStats.blocked} embeds held back so far.` : ""}</>} />
            </Section>

            <Section icon="🔒" title="Encrypted messages">
                <div className="meph-pv-note">
                    Press the <span className="meph-inline-lock"><LockIcon on width={14} height={14} /></span> button next to the message box in any chat and enter a passphrase you share with the other person.
                    Discord only ever stores scrambled text. Works between {"[MEPHEDRONE]"} users who share the passphrase.
                </div>
                <Toggle on={s.readerLink} onChange={v => settings.store.readerLink = v} title="Let friends on normal Discord read them"
                    desc="Encrypted messages include a link to a reader page. They type the passphrase once and can read and reply in their browser. Discord still only sees scrambled text." />
                {chats.length ? chats.map(c => (
                    <div key={c.id} className="meph-pv-chat">
                        <span>{chatName(c.id)}</span>
                        <span className={c.on ? "meph-pv-ok" : "meph-pv-off"}>{c.on ? "encrypting" : "paused"}</span>
                        <button className="meph-chip" onClick={() => E2E.setOn(c.id, !c.on).then(() => force(n => n + 1))}>{c.on ? "Pause" : "Resume"}</button>
                        <button className="meph-chip" onClick={() => openKeyModal(c.id)}>Key…</button>
                    </div>
                )) : <div className="meph-pv-empty">No encrypted chats yet.</div>}
            </Section>

            <Section icon="👻" title="Stealth">
                <Toggle on={!!s.ghost} onChange={v => setGhost(v).then(t => showToast({ text: t, variant: "success" }))} title="Ghost mode"
                    desc="Invisible + hidden game + silent typing in one switch. Also /ghost." />
                <Toggle on={s.autoInvisible} onChange={v => settings.store.autoInvisible = v} title="Go invisible every time the client starts" />
                <Toggle on={s.hideActivity} onChange={v => settings.store.hideActivity = v} title="Never show what I'm playing" />
                <Toggle on={isPluginEnabled("SilentTyping") && !!typing?.isEnabled}
                    onChange={v => { ensurePlugin("SilentTyping"); Settings.plugins.SilentTyping.isEnabled = v; }}
                    title="Silent typing" desc="Nobody sees '… is typing'." />
                <Toggle on={anon?.anonymiseByDefault !== false} onChange={v => { ensurePlugin("AnonymiseFileNames"); Settings.plugins.AnonymiseFileNames.anonymiseByDefault = v; }}
                    title="Anonymous file names" desc="Uploads get a random name instead of e.g. 'John_Smith_passport.jpg'." />
                <Toggle on={s.stripMetadata} onChange={v => settings.store.stripMetadata = v} title="Strip photo metadata"
                    desc="Removes GPS location, camera model, date and edit history from JPEG, PNG and WebP before upload." />
            </Section>

            <Section icon="🛡️" title="Lock & account safety">
                <div className="meph-pv-row static">
                    <div className="meph-pv-text">
                        <div className="meph-pv-title">Lock screen</div>
                        <div className="meph-pv-desc">Keeps people at your PC out of your chats. <b>Ctrl+Shift+L</b> locks instantly (panic key), or type /lock.</div>
                    </div>
                </div>
                <PinSetup />
                {s.pin && <>
                    <Toggle on={s.lockOnStart} onChange={v => settings.store.lockOnStart = v} title="Lock when the client starts" />
                    <div className="meph-pv-row static">
                        <div className="meph-pv-text"><div className="meph-pv-title">Lock after being idle</div></div>
                        <div className="meph-chips">
                            {[0, 5, 15, 30, 60].map(m => (
                                <button key={m} className={"meph-chip" + (s.idleMinutes === m ? " on" : "")} onClick={() => settings.store.idleMinutes = m}>{m ? `${m} min` : "Never"}</button>
                            ))}
                        </div>
                    </div>
                </>}
                <div className="meph-pv-row static">
                    <div className="meph-pv-text">
                        <div className="meph-pv-title">Token protection</div>
                        <div className="meph-pv-desc">Store plugins run in an isolated sandbox with no access to Discord's page, so they can never read your login token. They only get the permissions you approve.</div>
                    </div>
                </div>
            </Section>
        </div>
    );
}

export const PrivacyPage = ErrorBoundary.wrap(PrivacyPageInner, { noop: false });
