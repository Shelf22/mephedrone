/**
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ilyau and contributors
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { MediaEngine, MediaEngineConnection } from "@vencord/discord-types";
import { MediaEngineStore } from "@webpack/common";

import { settings } from "./settings";
import {
    disableAudioOverride,
    handlerFound,
    logger,
    markHandlerFound,
    notifyOverrideIfNeeded,
    overrideDisabledDueToMissingHandler,
    resetOverrideGuard
} from "./utils";
import { computeFakeDeafenState, desiredLocalDeaf, isSelfDeaf, isServerDeaf } from "./voiceState";

type SetSelfDeafFn = (deaf: boolean) => void;
type ConnectFn = (...args: unknown[]) => unknown;

const WRAPPED_ENGINE = Symbol.for("FakeDeafen.engine");
const WRAPPED_PROTO = Symbol.for("FakeDeafen.proto.setSelfDeaf");

const wrappedEngines = new WeakSet<object>();
const wrappedProtos = new WeakSet<object>();
const ownWrapOriginals = new WeakMap<object, SetSelfDeafFn>();
const engineConnectOriginals = new WeakMap<object, ConnectFn>();
const engineConnectHadOwn = new WeakMap<object, boolean>();
const protoSetSelfDeafOriginals = new WeakMap<object, SetSelfDeafFn>();
const lastAppliedLocalDeaf = new WeakMap<object, boolean>();

let installed = false;
let missingHandlerLogged = false;
let trackedEngine: MediaEngine | undefined;
let trackedProto: object | undefined;

export function shouldLocalDeaf(requested: boolean): boolean {
    if (!installed || overrideDisabledDueToMissingHandler) return Boolean(requested);

    markHandlerFound();

    if (!settings.store.enabled || !settings.store.keepHearing) return Boolean(requested);
    if (!requested) return false;
    if (isServerDeaf()) return true;

    return false;
}

function wrapOwnSetSelfDeaf(connection: MediaEngineConnection) {
    if (!connection || ownWrapOriginals.has(connection)) return;
    if (typeof connection.setSelfDeaf !== "function") return;
    if (!Object.prototype.hasOwnProperty.call(connection, "setSelfDeaf")) return;

    const original: SetSelfDeafFn = connection.setSelfDeaf;
    ownWrapOriginals.set(connection, original);
    connection.setSelfDeaf = function wrappedOwnSetSelfDeaf(this: MediaEngineConnection, deaf: boolean) {
        return original.call(this, shouldLocalDeaf(Boolean(deaf)));
    };
}

function wrapPrototype(connection: MediaEngineConnection) {
    const proto = connection && Object.getPrototypeOf(connection);
    if (!proto || typeof proto.setSelfDeaf !== "function") return;
    if (wrappedProtos.has(proto) || proto[WRAPPED_PROTO]) return;

    protoSetSelfDeafOriginals.set(proto, proto.setSelfDeaf);
    wrappedProtos.add(proto);
    trackedProto = proto;
    proto[WRAPPED_PROTO] = true;
    proto.setSelfDeaf = function wrappedProtoSetSelfDeaf(this: MediaEngineConnection, deaf: boolean) {
        const original = protoSetSelfDeafOriginals.get(proto);
        if (!original) return;
        return original.call(this, shouldLocalDeaf(Boolean(deaf)));
    };
}

function wrapConnection(connection: MediaEngineConnection | null | undefined) {
    if (!connection || connection.destroyed) return;
    wrapPrototype(connection);
    wrapOwnSetSelfDeaf(connection);
}

function isThenable(value: unknown): value is Promise<unknown> {
    return typeof (value as { then?: unknown; })?.then === "function";
}

function wrapEngine(engine: MediaEngine) {
    if (!engine || wrappedEngines.has(engine) || (engine as any)[WRAPPED_ENGINE]) return;

    trackedEngine = engine;

    if (typeof engine.connect === "function") {
        const originalConnect: ConnectFn = engine.connect;
        engineConnectOriginals.set(engine, originalConnect);
        engineConnectHadOwn.set(engine, Object.prototype.hasOwnProperty.call(engine, "connect"));
        (engine as MediaEngine & { connect: ConnectFn; }).connect = function wrappedConnect(this: MediaEngine, ...args: unknown[]) {
            const result = originalConnect.apply(this, args);
            const afterConnect = (connection: unknown) => {
                wrapConnection(connection as MediaEngineConnection);
                if (typeof (connection as MediaEngineConnection)?.setSelfDeaf === "function") {
                    markHandlerFound();
                    applyLocalAudioOverride("connect");
                } else if (connection && !missingHandlerLogged) {
                    missingHandlerLogged = true;
                    disableAudioOverride("New MediaEngine connection has no setSelfDeaf method.");
                }
            };

            if (isThenable(result)) {
                result.then(afterConnect, err => logger.error("MediaEngine.connect failed", err));
            } else {
                afterConnect(result);
            }

            return result;
        };
    }

    wrappedEngines.add(engine);
    (engine as any)[WRAPPED_ENGINE] = true;
}

function getMediaEngine(): MediaEngine | undefined {
    try {
        return MediaEngineStore.getMediaEngine?.() ?? trackedEngine;
    } catch (err) {
        logger.error("MediaEngineStore.getMediaEngine failed", err);
        return trackedEngine;
    }
}

function eachConnection(engine: MediaEngine, callback: (connection: MediaEngineConnection) => void) {
    if (typeof engine?.eachConnection === "function") {
        engine.eachConnection(callback);
        return;
    }

    engine.connections?.forEach?.(callback);
}

function restoreEngine(engine: MediaEngine) {
    const originalConnect = engineConnectOriginals.get(engine);
    if (originalConnect) {
        if (engineConnectHadOwn.get(engine)) {
            (engine as MediaEngine & { connect: ConnectFn; }).connect = originalConnect;
        } else {
            try {
                delete (engine as MediaEngine & { connect?: ConnectFn; }).connect;
            } catch {
                (engine as MediaEngine & { connect: ConnectFn; }).connect = originalConnect;
            }
        }
        engineConnectOriginals.delete(engine);
        engineConnectHadOwn.delete(engine);
    }
    wrappedEngines.delete(engine);
    try {
        delete (engine as any)[WRAPPED_ENGINE];
    } catch {
        (engine as any)[WRAPPED_ENGINE] = false;
    }
}

function restorePrototype(proto: any) {
    if (!proto) return;
    const protoOriginal = protoSetSelfDeafOriginals.get(proto);
    if (protoOriginal) proto.setSelfDeaf = protoOriginal;
    protoSetSelfDeafOriginals.delete(proto);
    wrappedProtos.delete(proto);
    try {
        delete proto[WRAPPED_PROTO];
    } catch {
        proto[WRAPPED_PROTO] = false;
    }
}

function restoreOwnSetSelfDeaf(connection: MediaEngineConnection) {
    const ownOriginal = ownWrapOriginals.get(connection);
    if (!ownOriginal) return;
    connection.setSelfDeaf = ownOriginal;
    ownWrapOriginals.delete(connection);
}

function getOriginalSetSelfDeaf(connection: MediaEngineConnection): SetSelfDeafFn | undefined {
    return (
        ownWrapOriginals.get(connection) ??
        protoSetSelfDeafOriginals.get(Object.getPrototypeOf(connection)) ??
        (typeof connection.setSelfDeaf === "function" ? connection.setSelfDeaf : undefined)
    );
}

function setConnectionLocalDeaf(connection: MediaEngineConnection, localDeaf: boolean, force = false) {
    if (!connection || connection.destroyed) return;
    if (!force && lastAppliedLocalDeaf.get(connection) === localDeaf) return;

    const original = getOriginalSetSelfDeaf(connection);
    if (!original) return;

    original.call(connection, localDeaf);
    lastAppliedLocalDeaf.set(connection, localDeaf);
}

function applyRealDeafState(engine: MediaEngine) {
    const shouldDeaf = isSelfDeaf() || isServerDeaf();
    eachConnection(engine, connection => {
        setConnectionLocalDeaf(connection, shouldDeaf, true);
    });
}

export function installAudioOverride(): boolean {
    installed = true;
    missingHandlerLogged = false;
    resetOverrideGuard();

    const engine = getMediaEngine();
    if (!engine) {
        logger.info("MediaEngine is not ready yet; will retry when you join a voice channel.");
        return false;
    }

    wrapEngine(engine);

    let foundSetSelfDeaf = false;
    eachConnection(engine, connection => {
        if (typeof connection?.setSelfDeaf !== "function") return;
        foundSetSelfDeaf = true;
        wrapConnection(connection);
    });

    if (foundSetSelfDeaf || typeof engine.connect === "function") {
        if (foundSetSelfDeaf) markHandlerFound();
        applyLocalAudioOverride("install");
        return true;
    }

    logger.info("No active MediaEngine connection yet; will retry on voice events.");
    return false;
}

export function uninstallAudioOverride() {
    installed = false;

    const engine = getMediaEngine();
    if (engine) eachConnection(engine, restoreOwnSetSelfDeaf);
    restorePrototype(trackedProto);
    if (engine) {
        restoreEngine(engine);
        applyRealDeafState(engine);
    }

    trackedEngine = undefined;
    trackedProto = undefined;
    resetOverrideGuard();
}

export function applyLocalAudioOverride(reason = "apply") {
    if (!installed || overrideDisabledDueToMissingHandler) return;

    const engine = getMediaEngine();
    if (!engine) return;

    wrapEngine(engine);

    let foundSetSelfDeaf = false;
    let connectionCount = 0;
    eachConnection(engine, connection => {
        connectionCount++;
        if (typeof connection?.setSelfDeaf !== "function") return;
        foundSetSelfDeaf = true;
        wrapConnection(connection);
    });

    if (foundSetSelfDeaf) markHandlerFound();

    const connectedWithoutHandler =
        connectionCount > 0 &&
        !foundSetSelfDeaf &&
        (reason.includes("RTC_CONNECTED") || reason === "connect");

    if (connectedWithoutHandler && !missingHandlerLogged) {
        missingHandlerLogged = true;
        disableAudioOverride("MediaEngineConnection.setSelfDeaf is unavailable on the active voice connection.");
        return;
    }

    if (!handlerFound) return;

    const state = computeFakeDeafenState();
    notifyOverrideIfNeeded(state.audioPlaybackOverride);

    const localDeaf = desiredLocalDeaf();
    eachConnection(engine, connection => {
        setConnectionLocalDeaf(connection, localDeaf);
    });
}
