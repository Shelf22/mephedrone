/* eslint-disable simple-header/header -- standalone plugin repo, not Vencord itself */
/*
 * NoiseDFN - DeepFilterNet3 noise suppression for Discord voice.
 * Copyright (c) 2026 FlimixST
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

// #region Settings

const settings = definePluginSettings({
    outboundEnabled: {
        type: OptionType.BOOLEAN,
        description: "Filter your own microphone",
        default: true,
    },
    attenLimDb: {
        type: OptionType.SLIDER,
        description: "Own mic suppression level",
        markers: [0, 25, 50, 75, 100],
        default: 85,
        stickToMarkers: false,
        componentProps: { onValueRender: (v: number) => `${Math.round(v)}%` },
    } as any,
    inboundEnabled: {
        type: OptionType.BOOLEAN,
        description: "Filter other users' microphones",
        default: false,
        onChange() { reconcileInbound(); },
    },
    inboundIds: {
        type: OptionType.STRING,
        description: "User IDs (comma-separated, empty = none)",
        default: "",
        onChange() { reconcileInbound(); },
    },
    inboundAtten: {
        type: OptionType.SLIDER,
        description: "Others' mics suppression level",
        markers: [0, 25, 50, 75, 100],
        default: 65,
        stickToMarkers: false,
        componentProps: { onValueRender: (v: number) => `${Math.round(v)}%` },
        onChange(value: number) { setInboundLevel(value); },
    } as any,
});

// #endregion

// #region Worklet source

const WORKLET_BODY = `
let dfInited = false;
class DeepFilterProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.frameLength = 480;
        this.inputBuffer = new Float32Array(1920);
        this.outputBuffer = new Float32Array(1920);
        this.inputWritePos = 0; this.inputReadPos = 0; this.outputWritePos = 0; this.outputReadPos = 0;
        this.bufferSize = 1920; this.tempFrame = null; this.dfHandle = 0; this.isInitialized = false; this.shouldFree = false;
        this.port.onmessage = (e) => {
            const { type, value } = e.data;
            if (type === 'free') {
                try { df_wasm.df_free(this.dfHandle); } catch {}
                this.dfHandle = 0;
                this.shouldFree = true;
            }
            else if (type === 'level' && this.dfHandle) { try { df_wasm.df_set_atten_lim(this.dfHandle, value); } catch {} }
        };
        const p = options.processorOptions;
        try {
            if (!dfInited) { df_wasm.initSync({ module: p.wasmModule }); dfInited = true; }
            this.dfHandle = df_wasm.df_create(p.modelBytes, p.suppressionLevel);
            try { df_wasm.df_set_post_filter_beta(this.dfHandle, 0); } catch {}
            this.frameLength = df_wasm.df_get_frame_length(this.dfHandle);
            this.bufferSize = this.frameLength * 2;
            this.inputBuffer = new Float32Array(this.bufferSize);
            this.outputBuffer = new Float32Array(this.bufferSize);
            this.tempFrame = new Float32Array(this.frameLength);
            // DFN works in 480-sample frames while Web Audio asks for 128-sample quanta.
            // Two frames of initial silence give the output buffer enough headroom so
            // process() never has to zero-fill while speech is flowing.
            this.prefillRemaining = this.bufferSize;
            this.isInitialized = true;
        } catch (e) { console.error('[NoiseDFN] Init fail:', e); }
    }
    process(inputs, outputs) {
        if (this.shouldFree) return false;
        if (!this.isInitialized || !this.tempFrame) {
            const input = inputs[0]; const output = outputs[0];
            if (input && input.length > 0) for (let ch = 0; ch < output.length; ch++) output[ch].set(input[0] || new Float32Array(128));
            return true;
        }
        const input = inputs[0]; const output = outputs[0];
        if (!input || input.length === 0 || !output || output.length === 0) return true;
        const inputData = input[0];
        for (let i = 0; i < inputData.length; i++) { this.inputBuffer[this.inputWritePos] = inputData[i]; this.inputWritePos = (this.inputWritePos + 1) % this.bufferSize; }
        while (((this.inputWritePos - this.inputReadPos + this.bufferSize) % this.bufferSize) >= this.frameLength) {
            for (let i = 0; i < this.frameLength; i++) { this.tempFrame[i] = this.inputBuffer[this.inputReadPos]; this.inputReadPos = (this.inputReadPos + 1) % this.bufferSize; }
            try {
                const processed = df_wasm.df_process_frame(this.dfHandle, this.tempFrame);
                for (let i = 0; i < processed.length; i++) { this.outputBuffer[this.outputWritePos] = processed[i]; this.outputWritePos = (this.outputWritePos + 1) % this.bufferSize; }
            } catch { for (let i = 0; i < this.frameLength; i++) { this.outputBuffer[this.outputWritePos] = this.tempFrame[i]; this.outputWritePos = (this.outputWritePos + 1) % this.bufferSize; } }
        }
        const outAvail = ((this.outputWritePos - this.outputReadPos + this.bufferSize) % this.bufferSize);
        if (this.prefillRemaining > 0) {
            this.prefillRemaining -= output[0][0].length;
            for (let ch = 0; ch < output.length; ch++) output[ch].fill(0);
        } else if (outAvail >= 128) {
            for (let ch = 0; ch < output.length; ch++) { let rp = this.outputReadPos; for (let j = 0; j < 128; j++) { output[ch][j] = this.outputBuffer[rp]; rp = (rp + 1) % this.bufferSize; } }
            this.outputReadPos = (this.outputReadPos + 128) % this.bufferSize;
        } else { for (let ch = 0; ch < output.length; ch++) output[ch].fill(0); }
        return true;
    }
}
registerProcessor('deepfilter-processor', DeepFilterProcessor);
`;

// #endregion

// #region Assets and worklet registration

let wasmMod: WebAssembly.Module | null = null;
let modelData: Uint8Array | null = null;
let glueText: string | null = null;

function b64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
}

async function loadAssets() {
    try {
        const helpers: any = (VencordNative as any).pluginHelpers;
        const Native: any = helpers?.NoiseDFN ?? helpers?.noisedfn ?? helpers?.DeepFilterNet3 ?? helpers?.deepfilternet3;
        if (Native?.getAsset) {
            const wasmB64 = await Native.getAsset("df_bg.wasm");
            const modelB64 = await Native.getAsset("DeepFilterNet3_onnx.tar.gz");
            const glueB64 = await Native.getAsset("df.js");
            if (wasmB64 && modelB64 && glueB64) {
                const mod = await WebAssembly.compile(b64ToBytes(wasmB64) as any);
                return { wasmModule: mod, modelBytes: b64ToBytes(modelB64), glueText: atob(glueB64) };
            }
        }
    } catch (e) { console.warn("[NoiseDFN] IPC failed", e); }
    return null;
}

function stripExports(g: string): string {
    // glue ships as an ES module; strip exports so it can be concatenated with the worklet body
    g = g.replace(/export\s+class\s+DFState/g, "class DFState")
        .replace(/export\s+function\s+/g, "function ")
        .replace(/export\s+type\s+[^;]+;/g, "").replace(/export\s+default\s+[^;]+;/g, "")
        .replace(/export\s*\{[^}]*\};?/g, "").replace(/export\s*\*[^;]*;/g, "");
    // df_create returns a raw pointer, not a DFState, so free it through the wasm-bindgen glue used by DFState.free()
    g += "\nvar df_wasm = { df_create, df_get_frame_length, df_process_frame, df_set_atten_lim, df_set_post_filter_beta, initSync, df_free: (st) => { wasm.__wbg_dfstate_free(st, 0); } };\n";
    return g;
}

function buildWorkletSource(): string {
    return stripExports(glueText!) + "\n" + WORKLET_BODY;
}

// One worklet module per AudioContext (ours for outbound, Discord's for inbound playback)
const workletReady = new WeakSet<AudioContext>();
const workletPending = new WeakSet<AudioContext>();

function ensureWorklet(ctx: AudioContext) {
    if (workletReady.has(ctx) || workletPending.has(ctx) || !glueText) return;
    workletPending.add(ctx);
    const url = URL.createObjectURL(new Blob([buildWorkletSource()], { type: "application/javascript" }));
    ctx.audioWorklet.addModule(url)
        .then(() => {
            workletReady.add(ctx);
            refreshOutputs(); // graphs that were waiting for the module can filter now
        })
        .catch(e => console.error("[NoiseDFN] worklet add fail", e))
        .finally(() => {
            workletPending.delete(ctx);
            URL.revokeObjectURL(url);
        });
}

// #endregion

// #region Media engine helpers

function getMediaEngine(): any {
    try {
        return (window as any).Vencord?.Webpack?.findByProps?.("getMediaEngine")?.getMediaEngine?.() ?? null;
    } catch { return null; }
}

function getUserIdForEvent(ev: RTCTrackEvent): string | null {
    // Discord's own handleTrack: stream id is `${userId}-${ssrc}`, and
    // conn.trackUserIds / conn.userIdsBySsrc carry the same mapping.
    const [streamUserId, streamSsrc] = (ev.streams?.[0]?.id ?? "").split("-");
    let uid: string | null = null;
    for (const conn of getMediaEngine()?.connections ?? []) {
        uid ??= conn.trackUserIds?.[ev.track.id] ?? null;
        if (streamSsrc) uid ??= conn.userIdsBySsrc?.get?.(Number(streamSsrc)) ?? null;
    }
    return uid ?? (/^\d{17,19}$/.test(streamUserId) ? streamUserId : null);
}

function shouldFilterInbound(userId: string | null): boolean {
    if (!settings.store.inboundEnabled) return false;
    const ids = (settings.store.inboundIds as string).split(",").map(s => s.trim()).filter(Boolean);
    return ids.length > 0 && ids.includes(userId ?? "");
}

// Go Live/screenshare streams are their own media engine connections with
// context === "stream"; only "default" connections carry user mics.
function isVoicePc(pc: unknown): boolean {
    const conns: any[] = Array.from(getMediaEngine()?.connections ?? []);
    if (!conns.length) return true;
    const owner = conns.find(c => c.pc === pc);
    return owner == null || owner.context !== "stream";
}

// #endregion

// #region Inbound

// Tracks that should be filtered. Populated from RTC track events, read by patchOutput().
const inboundMap = new Map<MediaStreamTrack, { userId: string | null }>();

// Discord's per-user playback nodes seen so far (the class volumeBooster patches)
const knownOutputs = new Set<any>();

function refreshOutputs() {
    for (const out of knownOutputs) {
        try { out.updateAudioElement?.(); } catch { }
    }
}

function setInboundLevel(value: number) {
    for (const out of knownOutputs) {
        try { out.__noisedfn?.node?.port.postMessage({ type: "level", value: Math.round(value) }); } catch { }
    }
}

interface OutputGraph {
    source: MediaStreamAudioSourceNode;
    gain: GainNode;
    node: AudioWorkletNode | null;
    filtered: boolean;
}

interface OutputData {
    audioContext: AudioContext;
    audioElement: HTMLAudioElement | null;
    stream: MediaStream;
    sinkId?: string | null;
    _mute?: boolean;
    _volume?: number;
    // added by volumeBooster when it runs the same module
    gainNode?: GainNode;
    // added by us
    __noisedfn?: OutputGraph;
    updateAudioElement?: () => void;
}

function ensureGraph(data: OutputData): OutputGraph {
    if (data.__noisedfn) return data.__noisedfn;
    const ctx = data.audioContext;
    const graph: OutputGraph = {
        source: ctx.createMediaStreamSource(data.stream),
        gain: ctx.createGain(),
        node: null,
        filtered: false,
    };
    graph.source.connect(graph.gain);
    graph.gain.connect(ctx.destination);
    data.__noisedfn = graph;
    ensureWorklet(ctx);
    return graph;
}

function detachGraph(data: OutputData) {
    const graph = data.__noisedfn;
    if (!graph) return;
    try { graph.source.disconnect(); } catch { }
    try { graph.gain.disconnect(); } catch { }
    try { graph.node?.port.postMessage({ type: "free" }); graph.node?.disconnect(); } catch { }
    // volumeBooster zeroes the element and plays through its own gain, leave that path alone
    if (data.audioElement && !data.gainNode) data.audioElement.volume = (data._volume ?? 100) / 100;
    delete data.__noisedfn;
}

// Called from the patched Discord playback class on every volume/mute/sink/track update.
function patchOutput(data: OutputData) {
    if (!isSetup || !wasmMod || !modelData) return; // not running yet: leave native playback untouched
    try {
        knownOutputs.add(data);
        const track = data.stream?.getAudioTracks?.()[0];
        const ctx = data.audioContext;
        const wantFilter = !!track && !!ctx && settings.store.inboundEnabled && inboundMap.has(track);

        // outputs nobody asked to filter keep Discord's own element playback
        if (!wantFilter) {
            detachGraph(data);
            return;
        }

        const graph = ensureGraph(data);
        if (!graph.filtered) {
            if (!workletReady.has(ctx!)) {
                ensureWorklet(ctx!);
                return; // raw audio keeps playing until the module is ready, refreshOutputs rewires after
            }
            graph.node = new AudioWorkletNode(ctx!, "deepfilter-processor", {
                processorOptions: {
                    wasmModule: wasmMod,
                    modelBytes: modelData,
                    suppressionLevel: Math.round(settings.store.inboundAtten),
                }
            });
            try { graph.source.disconnect(); } catch { }
            graph.source.connect(graph.node);
            graph.node.connect(graph.gain);
            graph.filtered = true;
        }

        graph.gain.gain.value = data._mute ? 0 : (data._volume ?? 100) / 100;

        // Discord's element must stay silent, our graph owns the playback now
        if (data.audioElement) data.audioElement.volume = 0;

        // volumeBooster plays the same stream through its own gain; keep it quiet to avoid raw double audio
        if (data.gainNode) data.gainNode.gain.value = 0;

        if (data.sinkId != null && data.sinkId !== (ctx as any).sinkId && "setSinkId" in AudioContext.prototype) {
            try { (ctx as any).setSinkId(data.sinkId === "default" ? "" : data.sinkId); } catch { }
        }
    } catch (e) {
        console.error("[NoiseDFN] output patch failed", e);
        try { detachGraph(data); } catch { }
    }
}

function releaseOutput(data: OutputData) {
    detachGraph(data);
    knownOutputs.delete(data);
    // let other playback patches (e.g. volumeBooster) restore their own gain
    try { data.updateAudioElement?.(); } catch { }
}

// Records the track for filtering; playback is wired up by patchOutput()
function applyInboundTrack(track: MediaStreamTrack, ev: RTCTrackEvent) {
    if (!settings.store.inboundEnabled || !wasmMod || !modelData) return;
    if (inboundMap.has(track) || track.kind !== "audio") return;
    if ((track as any).__NoiseDFN_own) return;
    const userId = getUserIdForEvent(ev);
    if (!shouldFilterInbound(userId)) return;
    inboundMap.set(track, { userId });
    track.addEventListener("ended", () => {
        inboundMap.delete(track);
        refreshOutputs();
    }, { once: true });
    refreshOutputs();
}

function scanExistingTracks() {
    try {
        for (const conn of getMediaEngine()?.connections ?? []) {
            for (const r of conn.pc?.getReceivers?.() ?? []) {
                const { track } = r;
                if (!track || track.kind !== "audio" || track.readyState !== "live" || inboundMap.has(track)) continue;
                let uid: string | null = conn.trackUserIds?.[track.id] ?? null;
                if (!uid) uid = getUserIdForEvent({ track, receiver: r, streams: [{ id: "" }] } as any);
                if (uid && shouldFilterInbound(uid)) {
                    applyInboundTrack(track, { track, receiver: r, streams: [{ id: "" }] } as any);
                }
            }
        }
    } catch { }
}

// Applies current inbound settings to live tracks without waiting for a new RTC event
function reconcileInbound() {
    for (const [track, entry] of [...inboundMap]) {
        if (!shouldFilterInbound(entry.userId)) inboundMap.delete(track);
    }
    scanExistingTracks();
    refreshOutputs();
}

function handleTrackEvent(ev: RTCTrackEvent) {
    const t = ev.track;
    if (!t || t.kind !== "audio") return;
    if (!isVoicePc(ev.target)) return;
    queueMicrotask(() => applyInboundTrack(t, ev));
}

// #endregion

// #region RTC and getUserMedia hooks

let origPCAddEventListener: typeof RTCPeerConnection.prototype.addEventListener | null = null;
let origOnTrackDesc: PropertyDescriptor | undefined;
let origGetUserMedia: typeof navigator.mediaDevices.getUserMedia | null = null;
let audioCtx: AudioContext | null = null;
let scanInterval: number | null = null;
let isSetup = false;

function patchRTC() {
    origPCAddEventListener = RTCPeerConnection.prototype.addEventListener;
    RTCPeerConnection.prototype.addEventListener = function (this: RTCPeerConnection, type: string, listener: any, options?: any) {
        if (type === "track" && typeof listener === "function") {
            const wrapped = function (this: RTCPeerConnection, ev: RTCTrackEvent) {
                const ret = listener.call(this, ev);
                try { handleTrackEvent(ev); } catch { }
                return ret;
            };
            return origPCAddEventListener!.call(this, type, wrapped as any, options);
        }
        return origPCAddEventListener!.call(this, type, listener, options);
    } as any;
    origOnTrackDesc = Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype, "ontrack");
    if (origOnTrackDesc) {
        Object.defineProperty(RTCPeerConnection.prototype, "ontrack", {
            get: origOnTrackDesc.get,
            set(this: RTCPeerConnection, v: any) {
                if (typeof v === "function") {
                    const w = function (this: RTCPeerConnection, ev: RTCTrackEvent) {
                        const ret = v.call(this, ev);
                        try { handleTrackEvent(ev); } catch { }
                        return ret;
                    };
                    return origOnTrackDesc!.set!.call(this, w);
                }
                return origOnTrackDesc!.set!.call(this, v);
            },
            configurable: true,
        });
    }
}

function unpatchRTC() {
    if (origPCAddEventListener) { RTCPeerConnection.prototype.addEventListener = origPCAddEventListener; origPCAddEventListener = null; }
    if (origOnTrackDesc) { Object.defineProperty(RTCPeerConnection.prototype, "ontrack", origOnTrackDesc); origOnTrackDesc = undefined; }
}

function patchGetUserMedia() {
    origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints: any) => {
        if (constraints?.video) return origGetUserMedia!.call(navigator.mediaDevices, constraints);
        if (constraints?.audio && typeof constraints.audio === "object") {
            constraints.audio.noiseSuppression = false;
            constraints.audio.echoCancellation = false;
            constraints.audio.autoGainControl = false;
        }
        const stream = await origGetUserMedia!.call(navigator.mediaDevices, constraints);
        const deviceId: string | null = typeof constraints?.audio === "object" ? (constraints.audio as any)?.deviceId?.exact ?? null : null;
        if (!settings.store.outboundEnabled || !audioCtx || !wasmMod || !modelData || !deviceId) return stream;
        try {
            if (audioCtx.state === "suspended") await audioCtx.resume();
            const source = audioCtx.createMediaStreamSource(stream);
            const node = new AudioWorkletNode(audioCtx, "deepfilter-processor", { processorOptions: { wasmModule: wasmMod, modelBytes: modelData, suppressionLevel: settings.store.attenLimDb } });
            const dest = audioCtx.createMediaStreamDestination();
            source.connect(node).connect(dest);
            const filtered = dest.stream;
            (filtered.getAudioTracks()[0] as any).__NoiseDFN_own = true;
            filtered.getAudioTracks().forEach(t => t.addEventListener("ended", () => {
                try { node.port.postMessage({ type: "free" }); node.disconnect(); source.disconnect(); } catch { }
            }));
            return filtered;
        } catch {
            return stream;
        }
    };
}

// #endregion

// #region Lifecycle

function cleanup() {
    isSetup = false; // keep patchOutput from rebuilding graphs while we release them
    if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
    for (const track of [...inboundMap.keys()]) inboundMap.delete(track);
    for (const out of [...knownOutputs]) releaseOutput(out);
    if (audioCtx) { try { audioCtx.close(); } catch { } audioCtx = null; }
    unpatchRTC();
    if (origGetUserMedia) { navigator.mediaDevices.getUserMedia = origGetUserMedia; origGetUserMedia = null; }
}

async function setupFilters() {
    if (isSetup) return;
    isSetup = true;
    const assets = await loadAssets();
    if (!assets) { isSetup = false; return; }
    wasmMod = assets.wasmModule;
    modelData = assets.modelBytes;
    glueText = assets.glueText;
    audioCtx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" as any });
    ensureWorklet(audioCtx);
    patchRTC();
    patchGetUserMedia();
    scanExistingTracks();
    scanInterval = window.setInterval(scanExistingTracks, 5000) as any;
    refreshOutputs();
}

// #endregion

export default definePlugin({
    name: "NoiseDFN",
    description: "Removes background noise from your mic and selected users mics",
    authors: [{ name: "FlimixST", id: 1120534568018116669n }],
    settings,

    // Discord's per-user/per-stream playback class (the one volumeBooster patches).
    // The injection point sits at the end of updateAudioElement, after Discord applied
    // its own element volume, so nothing here collides with volumeBooster's matches.
    patches: [
        {
            find: "streamSourceNode",
            predicate: () => !IS_DISCORD_DESKTOP,
            group: true,
            replacement: [
                {
                    // stream outputs never call updateAudioElement on their own until a volume change
                    match: /\}return"video"/,
                    replace: "this.updateAudioElement();$&"
                },
                {
                    match: /(null!=\i&&\i&&\i\.setSinkId\(\i\))\}/,
                    replace: "$1;$self.patchOutput(this)}"
                }
            ]
        }
    ],

    patchOutput,

    start() { setupFilters(); },
    stop() { cleanup(); },
});
