/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Voice lockdown:
//  1. WebRTC LAN-IP guard (safety net): the browser gathers "host" ICE candidates with your local network address.
//     As of 2026-11 Discord's web voice sends only ICE credentials/fingerprint/codecs, no candidates (verified by
//     capturing the voice gateway payload), so nothing leaks today. This strips private addresses from any SDP the
//     page reads and from icecandidate events in case that ever changes.
//  2. Call encryption status (Discord "secure frames" / DAVE): read from RTCConnectionStore.

const PRIVATE = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fc|fd|fe80:|::1$|0\.0\.0\.0)|\.local$/i;

export const ipGuardStats = { stripped: 0 };

function isPrivateCandidate(line: string) {
    // candidate:<foundation> <component> <proto> <priority> <address> <port> typ <type> …
    const parts = line.replace(/^a=/, "").split(" ");
    const addr = parts[4] ?? "";
    const typ = /typ (\w+)/.exec(line)?.[1];
    return typ === "host" && PRIVATE.test(addr);
}

function filterSdp(sdp: string) {
    let n = 0;
    const out = sdp.split(/\r?\n/).filter(l => {
        if (l.startsWith("a=candidate:") && isPrivateCandidate(l)) { n++; return false; }
        return true;
    }).join("\r\n");
    ipGuardStats.stripped += n;
    return out;
}

// WebRTC can be missing (some WebKit builds/settings): never let that take the client down
const P: any = typeof RTCPeerConnection === "function" ? RTCPeerConnection.prototype : null;
const saved: Record<string, PropertyDescriptor | undefined> = {};
const wrapped = new WeakMap<Function, Function>();
let origAdd: typeof EventTarget.prototype.addEventListener | null = null;
let origRemove: typeof EventTarget.prototype.removeEventListener | null = null;

function wrapListener(fn: any) {
    if (typeof fn !== "function") return fn;
    let w = wrapped.get(fn);
    if (!w) {
        w = function (this: any, e: RTCPeerConnectionIceEvent) {
            if (e?.candidate?.candidate && isPrivateCandidate(e.candidate.candidate)) { ipGuardStats.stripped++; return; }
            return fn.call(this, e);
        };
        wrapped.set(fn, w);
    }
    return w;
}

export function startIpGuard() {
    if (origAdd || !P) return;
    for (const k of ["localDescription", "currentLocalDescription", "pendingLocalDescription"]) {
        const d = Object.getOwnPropertyDescriptor(P, k);
        saved[k] = d;
        if (!d?.get) continue;
        Object.defineProperty(P, k, {
            configurable: true,
            get() {
                const desc = d.get!.call(this);
                return desc?.sdp ? new RTCSessionDescription({ type: desc.type, sdp: filterSdp(desc.sdp) }) : desc;
            },
        });
    }
    const on = Object.getOwnPropertyDescriptor(P, "onicecandidate");
    saved.onicecandidate = on;
    if (on?.set) Object.defineProperty(P, "onicecandidate", { configurable: true, get: on.get, set(fn) { on.set!.call(this, wrapListener(fn)); } });
    origAdd = P.addEventListener;
    origRemove = P.removeEventListener;
    P.addEventListener = function (type: string, fn: any, opts?: any) { return origAdd!.call(this, type, type === "icecandidate" ? wrapListener(fn) : fn, opts); };
    P.removeEventListener = function (type: string, fn: any, opts?: any) { return origRemove!.call(this, type, type === "icecandidate" ? wrapped.get(fn) ?? fn : fn, opts); };
}

export function stopIpGuard() {
    if (!origAdd || !P) return;
    for (const [k, d] of Object.entries(saved)) if (d) Object.defineProperty(P, k, d);
    P.addEventListener = origAdd;
    P.removeEventListener = origRemove;
    origAdd = origRemove = null;
}

// ---------- call encryption status

export interface CallSecurity { inCall: boolean; e2ee: boolean; version: number; others: number; }

export function callSecurity(): CallSecurity {
    const W = Vencord.Webpack;
    try {
        const R: any = W.findStore("RTCConnectionStore");
        const S = W.Common.SelectedChannelStore;
        const chan = S.getVoiceChannelId();
        if (!chan || !R?.isConnected?.()) return { inCall: false, e2ee: false, version: 0, others: 0 };
        const v = Number(R.getSecureFramesState?.()?.version ?? 0);
        const states = (W.findStore("VoiceStateStore") as any)?.getVoiceStatesForChannel?.(chan) ?? {};
        const me = W.Common.UserStore.getCurrentUser()?.id;
        const others = Object.keys(states).filter(id => id !== me).length;
        return { inCall: true, e2ee: v > 0, version: v, others };
    } catch {
        return { inCall: false, e2ee: false, version: 0, others: 0 };
    }
}
