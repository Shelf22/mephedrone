/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Button } from "@components/Button";
import { HistoryIcon } from "@components/Icons";
import SettingsPlugin from "@plugins/_core/settings";
import { BRAND } from "@shared/brand";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { removeFromArray } from "@utils/misc";
import definePlugin from "@utils/types";
import { ChannelStore, GuildStore, React, useEffect, UserStore, useState } from "@webpack/common";

import managedStyle from "./style.css?managed";

const KEY = "MephStats";
const TICK = 15;
const logger = new Logger("MephStats");

interface Day { sent: number; words: number; mentions: number; sec: number; }
interface Stats {
    since: number;
    sent: number;
    words: number;
    mentions: number;
    sec: number;
    days: Record<string, Day>;
    channels: Record<string, number>;
}

const fresh = (): Stats => ({ since: Date.now(), sent: 0, words: 0, mentions: 0, sec: 0, days: {}, channels: {} });

let stats: Stats | null = null;
let dirty = false;
let tick: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function today(s: Stats) {
    return s.days[dayKey()] ??= { sent: 0, words: 0, mentions: 0, sec: 0 };
}

function changed() {
    dirty = true;
    listeners.forEach(f => f());
}

async function save() {
    if (!stats || !dirty) return;
    dirty = false;
    // keep 120 days of history
    const keys = Object.keys(stats.days).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 120))) delete stats.days[k];
    await DataStore.set(KEY, stats).catch(e => logger.error("save failed", e));
}

function fmtTime(sec: number) {
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
    return h ? `${h}h ${m}m` : `${m}m`;
}

function channelLabel(id: string) {
    const c = ChannelStore.getChannel(id);
    if (!c) return "deleted / unknown channel";
    if (c.guild_id) {
        const g = GuildStore.getGuild(c.guild_id);
        return `#${c.name}${g ? ` · ${g.name}` : ""}`;
    }
    if (c.name) return c.name;
    const names = (c.recipients ?? []).map(r => {
        const u = UserStore.getUser(r);
        return u ? (u.globalName ?? u.username) : null;
    }).filter(Boolean);
    return names.length ? `@${names.join(", ")}` : "DM";
}

function StatsPage() {
    const [, force] = useState(0);
    useEffect(() => {
        const f = () => force(n => n + 1);
        listeners.add(f);
        return () => void listeners.delete(f);
    }, []);

    if (!stats) return <div className="meph-stats">Loading…</div>;
    const s = stats;
    const t = today(s);
    const last14 = Array.from({ length: 14 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (13 - i));
        return { label: d.toLocaleDateString(undefined, { weekday: "narrow" }), date: dayKey(d), ...(s.days[dayKey(d)] ?? { sent: 0, sec: 0 }) };
    });
    const max = Math.max(1, ...last14.map(d => d.sent));
    const top = Object.entries(s.channels).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const daysTracked = Math.max(1, Math.ceil((Date.now() - s.since) / 86400000));

    const card = (label: string, value: string | number, sub?: string) => (
        <div className="meph-stat">
            <div className="meph-stat-value">{value}</div>
            <div className="meph-stat-label">{label}</div>
            {sub && <div className="meph-stat-sub">{sub}</div>}
        </div>
    );

    return (
        <div className="meph-stats">
            <div className="meph-stats-head">Today</div>
            <div className="meph-stat-row">
                {card("messages sent", t.sent)}
                {card("words", t.words)}
                {card("pings & DMs", t.mentions)}
                {card("Discord open", fmtTime(t.sec))}
            </div>

            <div className="meph-stats-head">Last 14 days</div>
            <div className="meph-bars">
                {last14.map(d => (
                    <div key={d.date} className="meph-bar-col" title={`${d.date}: ${d.sent} messages, ${fmtTime(d.sec)} open`}>
                        <div className="meph-bar-n">{d.sent || ""}</div>
                        <div className="meph-bar" style={{ height: `${d.sent / max * 100}%` }} />
                        <div className="meph-bar-label">{d.label}</div>
                    </div>
                ))}
            </div>

            <div className="meph-stats-head">All time <span>since {new Date(s.since).toLocaleDateString()}</span></div>
            <div className="meph-stat-row">
                {card("messages sent", s.sent.toLocaleString(), `${(s.sent / daysTracked).toFixed(1)} a day`)}
                {card("words", s.words.toLocaleString())}
                {card("pings & DMs", s.mentions.toLocaleString())}
                {card("Discord open", fmtTime(s.sec))}
            </div>

            {top.length > 0 && <>
                <div className="meph-stats-head">Where you talk most</div>
                <div className="meph-top">
                    {top.map(([id, n], i) => (
                        <div key={id} className="meph-top-row">
                            <span className="meph-top-rank">{i + 1}</span>
                            <span className="meph-top-name">{channelLabel(id)}</span>
                            <span className="meph-top-n">{n}</span>
                        </div>
                    ))}
                </div>
            </>}

            <div style={{ marginTop: 24 }}>
                <Button variant="dangerSecondary" size="small" onClick={() => {
                    if (!confirm("Reset all your stats? This can't be undone.")) return;
                    stats = fresh();
                    changed();
                    save();
                }}>Reset stats</Button>
            </div>
        </div>
    );
}

export default definePlugin({
    name: "MephStats",
    description: `${BRAND}: counts messages you send, words, pings and time spent, shown under Settings › Stats. Stays on your PC.`,
    tags: ["Fun"],
    authors: [Devs.MephedroneTeam],
    enabledByDefault: true,
    managedStyle,

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: any; optimistic: boolean; }) {
            try {
                if (optimistic || !stats || !message?.author) return;
                const me = UserStore.getCurrentUser()?.id;
                if (!me) return;
                const t = today(stats);
                if (message.author.id === me) {
                    const words = (message.content ?? "").split(/\s+/).filter(Boolean).length;
                    stats.sent++; t.sent++;
                    stats.words += words; t.words += words;
                    stats.channels[message.channel_id] = (stats.channels[message.channel_id] ?? 0) + 1;
                    changed();
                } else if (message.mentions?.some((m: any) => m?.id === me) || (!message.guild_id && message.channel_id)) {
                    stats.mentions++; t.mentions++;
                    changed();
                }
            } catch (e) {
                logger.error(e);
            }
        },
    },

    async start() {
        stats = await DataStore.get<Stats>(KEY) ?? fresh();
        stats.days ??= {};
        stats.channels ??= {};
        let n = 0;
        tick = setInterval(() => {
            if (!stats) return;
            stats.sec += TICK;
            today(stats).sec += TICK;
            changed();
            if (++n % 4 === 0) save();
        }, TICK * 1000);
        addEventListener("beforeunload", save);

        SettingsPlugin.customEntries.push({
            key: "meph_stats",
            title: "Stats",
            panelTitle: `${BRAND} Stats`,
            Component: StatsPage,
            Icon: HistoryIcon,
        });
    },

    stop() {
        if (tick) clearInterval(tick);
        tick = null;
        removeEventListener("beforeunload", save);
        save();
        removeFromArray(SettingsPlugin.customEntries, e => e.key === "meph_stats");
    },
});
