/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Location spoofing. What the client itself tells Discord about where you are (verified 2026-11):
//   - X-Discord-Timezone header on API requests (e.g. "Europe/Berlin")
//   - system_locale in X-Super-Properties and in the gateway login (IDENTIFY)
//   - Accept-Language header
//   - account setting localization.timezoneOffset, re-synced after every login
// All of these are replaced with a fake city picked at startup. Times shown to YOU stay in your real timezone.
// Your IP address is not something a client can change: Discord's servers see it directly (use a VPN for that).

export interface FakePlace { city: string; tz: string; lat: number; lon: number; }

export const PLACES: FakePlace[] = [
    { city: "London", tz: "Europe/London", lat: 51.51, lon: -0.13 },
    { city: "Amsterdam", tz: "Europe/Amsterdam", lat: 52.37, lon: 4.9 },
    { city: "Berlin", tz: "Europe/Berlin", lat: 52.52, lon: 13.4 },
    { city: "Stockholm", tz: "Europe/Stockholm", lat: 59.33, lon: 18.07 },
    { city: "Madrid", tz: "Europe/Madrid", lat: 40.42, lon: -3.7 },
    { city: "Warsaw", tz: "Europe/Warsaw", lat: 52.23, lon: 21.01 },
    { city: "New York", tz: "America/New_York", lat: 40.71, lon: -74.01 },
    { city: "Chicago", tz: "America/Chicago", lat: 41.88, lon: -87.63 },
    { city: "Denver", tz: "America/Denver", lat: 39.74, lon: -104.99 },
    { city: "Los Angeles", tz: "America/Los_Angeles", lat: 34.05, lon: -118.24 },
    { city: "Vancouver", tz: "America/Vancouver", lat: 49.28, lon: -123.12 },
    { city: "São Paulo", tz: "America/Sao_Paulo", lat: -23.55, lon: -46.63 },
    { city: "Mexico City", tz: "America/Mexico_City", lat: 19.43, lon: -99.13 },
    { city: "Tokyo", tz: "Asia/Tokyo", lat: 35.68, lon: 139.69 },
    { city: "Seoul", tz: "Asia/Seoul", lat: 37.57, lon: 126.98 },
    { city: "Singapore", tz: "Asia/Singapore", lat: 1.35, lon: 103.82 },
    { city: "Sydney", tz: "Australia/Sydney", lat: -33.87, lon: 151.21 },
    { city: "Auckland", tz: "Pacific/Auckland", lat: -36.85, lon: 174.76 },
    { city: "Dubai", tz: "Asia/Dubai", lat: 25.2, lon: 55.27 },
    { city: "Johannesburg", tz: "Africa/Johannesburg", lat: -26.2, lon: 28.05 },
];

const FAKE_LOCALE = "en-US";
const FAKE_LANGS = "en-US,en;q=0.9";

export let current: (FakePlace & { offset: number; }) | null = null;
export const locStats = { headers: 0, identify: 0, settings: 0, geo: 0 };

/** getTimezoneOffset()-style minutes (positive = behind UTC) for an IANA zone, right now */
function offsetFor(tz: string) {
    const now = new Date();
    const inZone = new Date(now.toLocaleString("en-US", { timeZone: tz }));
    const inUtc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
    return Math.round((inUtc.getTime() - inZone.getTime()) / 60000);
}

const realTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; } })();
const realOffset = new Date().getTimezoneOffset();

export function pickPlace(fixedCity?: string) {
    const options = PLACES.filter(p => p.tz !== realTz && offsetFor(p.tz) !== realOffset);
    const p = (fixedCity && PLACES.find(x => x.city === fixedCity)) || options[Math.floor(Math.random() * options.length)];
    current = { ...p, offset: offsetFor(p.tz) };
    return current;
}

// ---------- request headers

const b64json = {
    decode: (s: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)))),
    encode: (o: any) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o)))),
};

function rewriteHeader(name: string, value: string): string {
    if (!current) return value;
    const n = name.toLowerCase();
    if (n === "x-discord-timezone") { locStats.headers++; return current.tz; }
    if (n === "accept-language") return FAKE_LANGS;
    if (n === "x-super-properties") {
        try { const sp = b64json.decode(value); sp.system_locale = FAKE_LOCALE; return b64json.encode(sp); } catch { return value; }
    }
    return value;
}

let origSetHeader: typeof XMLHttpRequest.prototype.setRequestHeader | null = null;
let origFetch: typeof fetch | null = null;
let origWsSend: typeof WebSocket.prototype.send | null = null;
let origGeo: { get: any; watch: any; } | null = null;

export function startLocationSpoof() {
    if (origSetHeader || !current) return;
    origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    const osh = origSetHeader;
    XMLHttpRequest.prototype.setRequestHeader = function (name: string, value: string) { return osh.call(this, name, rewriteHeader(name, value)); };

    origFetch = window.fetch;
    const of = origFetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
        if (init?.headers) {
            const h = new Headers(init.headers);
            for (const k of ["X-Discord-Timezone", "Accept-Language", "X-Super-Properties"]) { const v = h.get(k); if (v != null) h.set(k, rewriteHeader(k, v)); }
            init = { ...init, headers: h };
        }
        return of.call(this, input, init);
    };

    // gateway login (IDENTIFY, op 2) carries the same client properties
    origWsSend = WebSocket.prototype.send;
    const ows = origWsSend;
    WebSocket.prototype.send = function (this: WebSocket, data: any) {
        if (typeof data === "string" && data.startsWith('{"op":2') && /gateway/.test(this.url)) {
            try {
                const j = JSON.parse(data);
                if (j.d?.properties) { j.d.properties.system_locale = FAKE_LOCALE; data = JSON.stringify(j); locStats.identify++; }
            } catch { }
        }
        return ows.call(this, data);
    };

    // browser location API: answer with the fake city (a few km of jitter)
    if (navigator.geolocation) {
        const g = navigator.geolocation;
        origGeo = { get: g.getCurrentPosition, watch: g.watchPosition };
        const fake = () => {
            locStats.geo++;
            const j = () => (Math.random() - 0.5) * 0.06;
            return { coords: { latitude: current!.lat + j(), longitude: current!.lon + j(), accuracy: 3000, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as any;
        };
        g.getCurrentPosition = (ok: PositionCallback) => setTimeout(() => ok(fake()), 200);
        g.watchPosition = (ok: PositionCallback) => { setTimeout(() => ok(fake()), 200); return 0; };
    }
}

export function stopLocationSpoof() {
    if (origSetHeader) XMLHttpRequest.prototype.setRequestHeader = origSetHeader;
    if (origFetch) window.fetch = origFetch;
    if (origWsSend) WebSocket.prototype.send = origWsSend;
    if (origGeo && navigator.geolocation) { navigator.geolocation.getCurrentPosition = origGeo.get; navigator.geolocation.watchPosition = origGeo.watch; }
    origSetHeader = null; origFetch = null; origWsSend = null; origGeo = null;
}

// ---------- account setting (localization.timezoneOffset), which Discord re-syncs after each login

let wrappedSetting: any = null;
let origUpdate: any = null;

function tzSetting() {
    const all = Vencord.Api.UserSettings.UserSettings as any;
    return all && Object.values(all).find((d: any) => d?.userSettingsAPIGroup === "localization" && d?.userSettingsAPIName === "timezoneOffset");
}

export function guardTimezoneSetting() {
    if (!current) return;
    const d: any = tzSetting();
    if (!d) return;
    if (wrappedSetting !== d) {
        origUpdate = d.updateSetting;
        const ou = origUpdate;
        d.updateSetting = (v: any) => {
            // Discord writes the real offset after every login; swap in the fake one
            if (current && typeof v === "number" && v !== current.offset) { locStats.settings++; v = current.offset; }
            return ou.call(d, v);
        };
        wrappedSetting = d;
    }
    try { if (d.getSetting() !== current.offset) d.updateSetting(current.offset); } catch { }
}

export function unguardTimezoneSetting() {
    if (wrappedSetting && origUpdate) wrappedSetting.updateSetting = origUpdate;
    wrappedSetting = origUpdate = null;
}
