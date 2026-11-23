/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Second layer behind NoTrack: drops Discord's tracking requests at the network level and counts them.

const BLOCK = /\/api\/v\d+\/(science|metrics|track|scheduled-messages\/analytics)(\/|\?|$)|sentry\.io|\/error-reporting-proxy\//;

export const blocked = { count: 0, byType: {} as Record<string, number> };
const listeners = new Set<() => void>();
export const onBlocked = (f: () => void) => (listeners.add(f), () => void listeners.delete(f));

/** an analytics event Discord tried to record (dropped by NoTrack before any request was built) */
export function countEvent() {
    blocked.count++;
    blocked.byType.analytics = (blocked.byType.analytics ?? 0) + 1;
    listeners.forEach(f => f());
}

function hit(url: string) {
    const kind = /science|track/.test(url) ? "analytics" : /metrics/.test(url) ? "metrics" : "crash reports";
    blocked.count++;
    blocked.byType[kind] = (blocked.byType[kind] ?? 0) + 1;
    listeners.forEach(f => f());
}

let orig: { open: typeof XMLHttpRequest.prototype.open; send: typeof XMLHttpRequest.prototype.send; fetch: typeof fetch; beacon: typeof navigator.sendBeacon; } | null = null;
const BLOCKED = Symbol("mephBlocked");

export function startTelemetryBlock() {
    if (orig) return;
    const P = XMLHttpRequest.prototype;
    orig = { open: P.open, send: P.send, fetch: window.fetch, beacon: navigator.sendBeacon };
    const o = orig;

    P.open = function (this: any, method: string, url: string | URL, ...rest: any[]) {
        this[BLOCKED] = BLOCK.test(String(url));
        if (this[BLOCKED]) hit(String(url));
        return (o.open as any).call(this, method, url, ...rest);
    } as any;
    P.send = function (this: any, body?: any) {
        if (this[BLOCKED]) {
            // pretend it worked so Discord doesn't retry
            Object.defineProperty(this, "readyState", { value: 4, configurable: true });
            Object.defineProperty(this, "status", { value: 204, configurable: true });
            setTimeout(() => { this.onreadystatechange?.(); this.onload?.(); this.dispatchEvent(new Event("load")); this.dispatchEvent(new Event("loadend")); });
            return;
        }
        return o.send.call(this, body);
    };
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (BLOCK.test(url)) { hit(url); return Promise.resolve(new Response(null, { status: 204 })); }
        return o.fetch.call(this, input, init);
    };
    navigator.sendBeacon = function (url: string | URL, data?: BodyInit | null) {
        if (BLOCK.test(String(url))) { hit(String(url)); return true; }
        return o.beacon.call(navigator, url, data);
    };
}

export function stopTelemetryBlock() {
    if (!orig) return;
    XMLHttpRequest.prototype.open = orig.open;
    XMLHttpRequest.prototype.send = orig.send;
    window.fetch = orig.fetch;
    navigator.sendBeacon = orig.beacon;
    orig = null;
}
