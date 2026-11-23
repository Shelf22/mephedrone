/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent, utilityProcess } from "electron";
import { writeFileSync } from "fs";
import http from "http";
import { tmpdir } from "os";
import { join } from "path";

interface TrackState {
    track: {
        id: string;
        title: string;
        artist: string;
        duration: number;
        thumbnail?: string;
        permalink?: string;
    } | null;
    isPlaying: boolean;
    position: number;
    _ts: number;
}

let server: http.Server | null = null;
let latestState: TrackState | null = null;
let currentPort = 0;

function setCors(res: http.ServerResponse) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
}

function startServer(port: number) {
    if (server && currentPort === port) return;
    stopServer();
    currentPort = port;

    server = http.createServer((req, res) => {
        setCors(res);
        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }
        if (req.method !== "POST" || req.url !== "/state") {
            res.writeHead(404);
            res.end();
            return;
        }

        let body = "";
        req.on("data", (chunk: Buffer) => {
            body += chunk.toString();
        });
        req.on("end", () => {
            try {
                const parsed = JSON.parse(body);
                latestState = parsed ? { ...parsed, _ts: Date.now() } : null;
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end("{}");
            } catch {
                res.writeHead(400);
                res.end();
            }
        });
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE")
            console.error(`[SoundCloudRPC] Port ${port} already in use`);
    });

    server.listen(port, "127.0.0.1");
    console.log(`[SoundCloudRPC] Listening on 127.0.0.1:${port}`);
}

function stopServer() {
    server?.close();
    server = null;
    latestState = null;
}

const WORKER_LINES = [
    "const net = require('net');",
    "let sock = null, ready = false, pending = undefined;",
    "let activeId = '', rxBuf = Buffer.alloc(0), retryTimer = null;",
    "",
    "function pipePath(id) {",
    "  if (process.platform === 'win32') {",
    "    const s = String.fromCharCode(92);",
    "    return s + s + '.' + s + 'pipe' + s + 'discord-ipc-' + id;",
    "  }",
    "  const tmp = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp';",
    "  return tmp + '/discord-ipc-' + id;",
    "}",
    "",
    "function frame(op, data) {",
    "  const s = JSON.stringify(data);",
    "  const b = Buffer.allocUnsafe(8 + Buffer.byteLength(s, 'utf8'));",
    "  b.writeUInt32LE(op, 0);",
    "  b.writeUInt32LE(Buffer.byteLength(s, 'utf8'), 4);",
    "  b.write(s, 8, 'utf8');",
    "  return b;",
    "}",
    "",
    "function write(op, data) {",
    "  if (sock && sock.writable) try { sock.write(frame(op, data)); } catch(e) {}",
    "}",
    "",
    "function flush(activity) {",
    "  write(1, {",
    "    cmd: 'SET_ACTIVITY',",
    "    args: { pid: process.pid, activity: activity },",
    "    evt: null,",
    "    nonce: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)",
    "  });",
    "}",
    "",
    "function onData(chunk) {",
    "  rxBuf = Buffer.concat([rxBuf, chunk]);",
    "  while (rxBuf.length >= 8) {",
    "    const len = rxBuf.readUInt32LE(4);",
    "    if (rxBuf.length < 8 + len) break;",
    "    const op  = rxBuf.readUInt32LE(0);",
    "    const msg = rxBuf.subarray(8, 8 + len).toString('utf8');",
    "    rxBuf = rxBuf.subarray(8 + len);",
    "    if (op !== 1) continue;",
    "    try {",
    "      const p = JSON.parse(msg);",
    "      if (p.evt === 'READY') {",
    "        ready = true;",
    "        if (pending !== undefined) { flush(pending); pending = undefined; }",
    "      }",
    "    } catch(e) {}",
    "  }",
    "}",
    "",
    "function connect(id) {",
    "  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }",
    "  if (sock) { try { sock.destroy(); } catch(e) {} sock = null; }",
    "  ready = false; rxBuf = Buffer.alloc(0); activeId = id;",
    "  let n = 0;",
    "  function tryNext() {",
    "    if (n > 9) {",
    "      retryTimer = setTimeout(function() { connect(activeId); }, 15000);",
    "      return;",
    "    }",
    "    const s = net.createConnection(pipePath(n++));",
    "    s.once('connect', function() {",
    "      sock = s;",
    "      s.on('data', onData);",
    "      s.on('close', function() {",
    "        if (sock === s) { sock = null; ready = false; }",
    "        if (!retryTimer)",
    "          retryTimer = setTimeout(function() { connect(activeId); }, 15000);",
    "      });",
    "      write(0, { v: 1, client_id: id });",
    "    });",
    "    s.once('error', tryNext);",
    "  }",
    "  tryNext();",
    "}",
    "",
    "function handle(m) {",
    "  if (!m) return;",
    "  const cid = m.clientId || '';",
    "  if (!cid) {",
    "    if (ready) flush(null); else pending = null;",
    "    return;",
    "  }",
    "  if (cid !== activeId || !sock) { pending = m.activity; connect(cid); }",
    "  else if (ready) flush(m.activity);",
    "  else pending = m.activity;",
    "}",
    "",
    "if (process.parentPort) {",
    "  process.parentPort.on('message', function(event) { handle(event.data); });",
    "  process.parentPort.start();",
    "}",
];

const WORKER_CODE = WORKER_LINES.join("\n");
const WORKER_PATH = join(tmpdir(), "scrpc_worker.js");

let rpcProc: Electron.UtilityProcess | null = null;
let workerFileWritten = false;

function ensureWorker(): Electron.UtilityProcess | null {
    if (rpcProc) return rpcProc;

    if (!workerFileWritten) {
        try {
            writeFileSync(WORKER_PATH, WORKER_CODE, "utf8");
            workerFileWritten = true;
        } catch (e) {
            console.error("[SoundCloudRPC] Failed to write worker:", e);
            return null;
        }
    }

    try {
        rpcProc = utilityProcess.fork(WORKER_PATH);
        rpcProc.on("exit", () => {
            rpcProc = null;
        });
        return rpcProc;
    } catch (e) {
        console.error("[SoundCloudRPC] utilityProcess.fork failed:", e);
        return null;
    }
}

function stopWorker() {
    if (!rpcProc) return;
    try {
        rpcProc.postMessage({ clientId: "", activity: null });
    } catch {}
    setTimeout(() => {
        rpcProc?.kill();
        rpcProc = null;
    }, 300);
}

export function start(_e: IpcMainInvokeEvent, port: number): void {
    startServer(port);
}

export function stop(_e: IpcMainInvokeEvent): void {
    stopServer();
    stopWorker();
}

export function getState(_e: IpcMainInvokeEvent): TrackState | null {
    return latestState;
}

export function setActivity(
    _e: IpcMainInvokeEvent,
    clientId: string,
    activity: object | null,
): void {
    const proc = ensureWorker();
    if (!proc) return;
    try {
        proc.postMessage({ clientId: clientId || "", activity });
    } catch (e) {
        console.error("[SoundCloudRPC] postMessage failed:", e);
        rpcProc = null;
    }
}
