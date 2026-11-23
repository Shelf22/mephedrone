/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Runs inside each store plugin's Web Worker before the plugin's own code.
// A worker has no DOM, no Discord page, no localStorage and therefore no access to your token.
// Here we also take away every way to reach the network on its own; the only way out is the
// `meph` API, and the client checks each call against the permissions you approved.

export const PRELUDE = String.raw`"use strict";
(() => {
    const post = self.postMessage.bind(self);
    for (const k of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "Worker", "SharedWorker",
        "WebTransport", "indexedDB", "caches", "BroadcastChannel", "RTCPeerConnection", "Request", "Response"]) {
        try { Object.defineProperty(self, k, { value: undefined, writable: false, configurable: false }); } catch {}
    }
    try { Object.defineProperty(self, "postMessage", { value: undefined, writable: false, configurable: false }); } catch {}

    let seq = 0;
    const pending = new Map();
    const handlers = {};
    const call = (op, args) => new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        post({ t: "call", id, op, args });
    });

    self.onmessage = async e => {
        const m = e.data;
        if (m.t === "ret") {
            const p = pending.get(m.id);
            if (!p) return;
            pending.delete(m.id);
            m.error ? p.reject(new Error(m.error)) : p.resolve(m.value);
        } else if (m.t === "event") {
            let value;
            for (const h of handlers[m.name] ?? []) {
                try { value = await h(m.payload); } catch (err) { post({ t: "log", level: "error", text: String(err && err.stack || err) }); }
            }
            if (m.id) post({ t: "evret", id: m.id, value });
        }
    };
    self.onerror = e => post({ t: "log", level: "error", text: String(e.message || e) });
    self.onunhandledrejection = e => post({ t: "log", level: "error", text: String(e.reason && e.reason.stack || e.reason) });

    const meph = Object.freeze({
        on: (name, fn) => { (handlers[name] ??= []).push(fn); },
        commands: Object.freeze({
            register: (def, fn) => { handlers["command:" + def.name] = [fn]; return call("commands.register", def); },
        }),
        messages: Object.freeze({
            send: (channelId, content) => call("messages.send", { channelId, content }),
        }),
        ui: Object.freeze({
            toast: (text, variant) => call("ui.toast", { text, variant }),
            css: css => call("ui.css", { css }),
        }),
        net: Object.freeze({
            json: (url, init) => call("net.fetch", { url, init, as: "json" }),
            text: (url, init) => call("net.fetch", { url, init, as: "text" }),
        }),
        storage: Object.freeze({
            get: key => call("storage.get", { key }),
            set: (key, value) => call("storage.set", { key, value }),
        }),
        settings: Object.freeze({ get: () => call("settings.get") }),
        log: (...a) => post({ t: "log", level: "info", text: a.map(String).join(" ") }),
    });
    Object.defineProperty(self, "meph", { value: meph, writable: false, configurable: false });
})();
`;
