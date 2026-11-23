/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Host side of store plugins: one Web Worker per plugin, every request checked against its approved permissions.

import { ApplicationCommandInputType, ApplicationCommandOptionType, registerCommand, sendBotMessage, unregisterCommand } from "@api/Commands";
import { Logger } from "@utils/Logger";
import { MessageActions, showToast, UserStore } from "@webpack/common";

import { PRELUDE } from "./sandbox";
import { Installed, Permission } from "./types";

const logger = new Logger("MephStore");

interface Running {
    id: string;
    plugin: Installed;
    worker: Worker;
    url: string;
    commands: string[];
    style: HTMLStyleElement | null;
    waits: Map<number, (v: any) => void>;
    sent: number[];
    errors: string[];
}

export const running = new Map<string, Running>();
let save: () => void = () => { };
let evSeq = 0;
const listeners = new Set<() => void>();
export const onRuntimeChange = (f: () => void) => (listeners.add(f), () => void listeners.delete(f));
const changed = () => listeners.forEach(f => f());

export function setSaver(fn: () => void) { save = fn; }

const has = (r: Running, p: Permission) => r.plugin.manifest.permissions.includes(p);

function need(r: Running, p: Permission) {
    if (!has(r, p)) throw new Error(`"${r.plugin.manifest.name}" doesn't have the "${p}" permission`);
}

const OPTION_TYPES: Record<string, ApplicationCommandOptionType> = {
    string: ApplicationCommandOptionType.STRING,
    number: ApplicationCommandOptionType.NUMBER,
    integer: ApplicationCommandOptionType.INTEGER,
    boolean: ApplicationCommandOptionType.BOOLEAN,
};

/** send an event to a plugin; if wait is set, resolves with the handler's return value (or undefined after the timeout) */
function emit(r: Running, name: string, payload: any, waitMs = 0): Promise<any> {
    if (!waitMs) { r.worker.postMessage({ t: "event", name, payload }); return Promise.resolve(); }
    const id = ++evSeq;
    return new Promise(resolve => {
        const timer = setTimeout(() => { r.waits.delete(id); resolve(undefined); }, waitMs);
        r.waits.set(id, v => { clearTimeout(timer); resolve(v); });
        r.worker.postMessage({ t: "event", name, payload, id });
    });
}

async function sendAs(r: Running, channelId: string, content: unknown) {
    need(r, "messages.send");
    if (typeof content !== "string" || !content.trim()) throw new Error("Empty message");
    const now = Date.now();
    r.sent = r.sent.filter(t => now - t < 10_000);
    if (r.sent.length >= 5) throw new Error("Rate limit: max 5 messages per 10 seconds");
    r.sent.push(now);
    await MessageActions.sendMessage(channelId, { content: content.slice(0, 2000), tts: false, invalidEmojis: [], validNonShortcutEmojis: [] }, undefined, {});
}

async function netFetch(r: Running, { url, init, as }: { url: string; init?: any; as: "json" | "text"; }) {
    need(r, "network");
    const u = new URL(url);
    if (u.protocol !== "https:") throw new Error("Only https:// is allowed");
    const allowed = r.plugin.manifest.network ?? [];
    if (!allowed.some(d => u.hostname === d || u.hostname.endsWith("." + d)))
        throw new Error(`Not allowed to connect to ${u.hostname} (allowed: ${allowed.join(", ")})`);
    const res = await fetch(u.href, {
        method: init?.method ?? "GET",
        headers: init?.headers,
        body: typeof init?.body === "string" ? init.body : undefined,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
    });
    const text = await res.text();
    if (text.length > 2_000_000) throw new Error("Response too large");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return as === "json" ? JSON.parse(text) : text;
}

async function handleCall(r: Running, op: string, args: any) {
    switch (op) {
        case "commands.register": {
            need(r, "commands");
            const name = String(args?.name ?? "").toLowerCase();
            if (!/^[\w-]{1,32}$/.test(name)) throw new Error("Bad command name");
            registerCommand({
                name,
                description: `${String(args.description ?? "").slice(0, 90)} (${r.plugin.manifest.name})`,
                inputType: ApplicationCommandInputType.BUILT_IN,
                options: (args.options ?? []).map((o: any) => ({
                    name: String(o.name), description: String(o.description ?? o.name),
                    type: OPTION_TYPES[o.type] ?? ApplicationCommandOptionType.STRING, required: !!o.required,
                })),
                execute: async (cmdArgs, ctx) => {
                    const values = Object.fromEntries(cmdArgs.map(a => [a.name, a.value]));
                    const res = await emit(r, "command:" + name, { ...values, channelId: ctx.channel.id }, 15_000);
                    try {
                        if (res?.send) await sendAs(r, ctx.channel.id, res.send);
                        else if (res?.reply) sendBotMessage(ctx.channel.id, { content: String(res.reply).slice(0, 2000) });
                    } catch (e) {
                        sendBotMessage(ctx.channel.id, { content: `⚠️ ${r.plugin.manifest.name}: ${(e as Error).message}` });
                    }
                },
            }, `MephStore:${r.id}`);
            r.commands.push(name);
            return true;
        }
        case "messages.send":
            await sendAs(r, String(args.channelId), args.content);
            return true;
        case "ui.toast":
            need(r, "notify");
            showToast({ text: `${r.plugin.manifest.icon ?? "🧩"} ${String(args.text).slice(0, 200)}`, variant: args.variant === "critical" ? "critical" : args.variant === "success" ? "success" : "default" });
            return true;
        case "ui.css":
            need(r, "style");
            if (!r.style) {
                r.style = document.createElement("style");
                r.style.id = `meph-store-${r.id}`;
                document.head.appendChild(r.style);
            }
            r.style.textContent = String(args.css).slice(0, 100_000);
            return true;
        case "net.fetch":
            return netFetch(r, args);
        case "storage.get":
            return r.plugin.storage[String(args.key)];
        case "storage.set": {
            r.plugin.storage[String(args.key)] = args.value;
            if (JSON.stringify(r.plugin.storage).length > 1_000_000) { delete r.plugin.storage[String(args.key)]; throw new Error("Storage full (1 MB)"); }
            save();
            return true;
        }
        case "settings.get":
            return defaultsWith(r.plugin);
        default:
            throw new Error(`Unknown call ${op}`);
    }
}

export function defaultsWith(p: Installed) {
    const out: Record<string, any> = {};
    for (const [k, d] of Object.entries(p.manifest.settings ?? {})) out[k] = p.settings[k] ?? d.default;
    return out;
}

export function startStorePlugin(plugin: Installed) {
    const { id } = plugin.manifest;
    if (running.has(id)) return;
    // [MEPHEDRONE] security: dynamic import() is syntax, so the sandbox can't delete it, and the page policy allows
    // scripts from CDNs that serve any GitHub repo. A plugin could load unreviewed code past its fingerprint. Store
    // plugins never need it, so any code containing the keyword is refused (fail closed).
    if (/\bimport\b/.test(plugin.code)) throw new Error(`${id}: plugin code uses "import", which store plugins may not do`);
    const blob = new Blob([PRELUDE, "\n", plugin.code, `\n//# sourceURL=mephedrone-store/${id}.js`], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url, { name: `store:${id}` });
    const r: Running = { id, plugin, worker, url, commands: [], style: null, waits: new Map(), sent: [], errors: [] };
    running.set(id, r);
    worker.onmessage = async e => {
        const m = e.data;
        if (m?.t === "call") {
            try {
                worker.postMessage({ t: "ret", id: m.id, value: await handleCall(r, m.op, m.args) });
            } catch (err) {
                worker.postMessage({ t: "ret", id: m.id, error: (err as Error).message });
            }
        } else if (m?.t === "evret") {
            r.waits.get(m.id)?.(m.value);
            r.waits.delete(m.id);
        } else if (m?.t === "log") {
            (m.level === "error" ? logger.error : logger.info)(`[${id}]`, m.text);
            if (m.level === "error") { r.errors = [...r.errors.slice(-4), String(m.text).slice(0, 300)]; changed(); }
        }
    };
    worker.onerror = e => { r.errors = [...r.errors.slice(-4), e.message]; logger.error(`[${id}] crashed`, e.message); changed(); };
    changed();
}

export function stopStorePlugin(id: string) {
    const r = running.get(id);
    if (!r) return;
    r.worker.terminate();
    URL.revokeObjectURL(r.url);
    r.commands.forEach(c => unregisterCommand(c));
    r.style?.remove();
    running.delete(id);
    changed();
}

export function settingsChanged(id: string) {
    const r = running.get(id);
    if (r) emit(r, "settings", defaultsWith(r.plugin));
}

// ---------- events fanned out to plugins

export function onIncomingMessage(message: any) {
    const me = UserStore.getCurrentUser()?.id;
    for (const r of running.values()) {
        if (!has(r, "messages.read")) continue;
        emit(r, "message", {
            id: message.id,
            channelId: message.channel_id,
            guildId: message.guild_id ?? null,
            content: String(message.content ?? ""),
            author: { id: message.author?.id, username: message.author?.global_name ?? message.author?.username, bot: !!message.author?.bot },
            fromMe: message.author?.id === me,
            mentionsMe: !!message.mentions?.some((u: any) => u?.id === me),
            timestamp: message.timestamp,
        });
    }
}

export async function transformOutgoing(channelId: string, content: string) {
    let text = content;
    for (const r of running.values()) {
        if (!has(r, "messages.transform")) continue;
        const out = await emit(r, "beforeSend", { channelId, content: text }, 500);
        if (typeof out === "string" && out.trim()) text = out.slice(0, 4000);
    }
    return text;
}
