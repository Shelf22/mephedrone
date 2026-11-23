/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Tiny Chrome DevTools Protocol client for the test rig.
//   node tools/cdp.mjs eval "<js expression>"     run in the Discord page (awaits promises), print JSON
//   node tools/cdp.mjs shot <file.png> [selector] screenshot the page (or one element)
//   node tools/cdp.mjs watch <logfile>            append console messages + exceptions until killed
//   node tools/cdp.mjs reload                     reload the page
const PORT = process.env.CDP_PORT ?? 9333;
const [cmd, ...args] = process.argv.slice(2);

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
if (cmd === "extreload") {
    // reload unpacked extensions through chrome://extensions (works even when the service worker is asleep)
    const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?chrome://extensions`, { method: "PUT" })).json();
    const w = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise(r => w.onopen = r);
    await new Promise(r => setTimeout(r, 800));
    const done = new Promise(r => w.onmessage = e => { const m = JSON.parse(e.data); if (m.id === 1) r(m); });
    w.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { awaitPromise: true, returnByValue: true,
        expression: "chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode: true}).then(() => chrome.developerPrivate.getExtensionsInfo()).then(l => Promise.all(l.map(e => chrome.developerPrivate.reload(e.id, {failQuietly: true}).then(() => chrome.management.setEnabled(e.id, true)))).then(() => l.length))" } }));
    const res = await done;
    console.log("extensions reloaded:", res.result?.result?.value ?? JSON.stringify(res.result));
    w.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`);
    await new Promise(r => setTimeout(r, 1000));
}

const t = targets.find(x => x.type === "page" && /discord\.com/.test(x.url)) ?? targets.find(x => x.type === "page");
if (!t) { console.error("no page target"); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const handlers = [];
ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else handlers.forEach(h => h(m));
};
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise(r => ws.onopen = r);

if (cmd === "eval") {
    const r = await send("Runtime.evaluate", { expression: args.join(" "), awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.result?.exceptionDetails) console.log("EXCEPTION:", r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    else console.log(JSON.stringify(r.result?.result?.value, null, 1) ?? r.result?.result?.description);
} else if (cmd === "shot") {
    const { writeFileSync } = await import("fs");
    let clip;
    if (args[1]) {
        const r = await send("Runtime.evaluate", { expression: `(()=>{const b=document.querySelector(${JSON.stringify(args[1])})?.getBoundingClientRect();return b&&{x:b.x,y:b.y,width:b.width,height:b.height,scale:1}})()`, returnByValue: true });
        clip = r.result?.result?.value;
    }
    const r = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip } : {}) });
    writeFileSync(args[0], Buffer.from(r.result.data, "base64"));
    console.log("saved", args[0]);
} else if (cmd === "watch") {
    const { appendFileSync } = await import("fs");
    const out = s => appendFileSync(args[0], `[${new Date().toISOString().slice(11, 19)}] ${s}\n`);
    handlers.push(m => {
        if (m.method === "Runtime.consoleAPICalled") {
            const txt = m.params.args.map(a => a.value ?? a.description ?? a.type).join(" ");
            const clean = txt.replace(/%c|background:[^;]*;|color:[^;]*;|font-weight:[^;]*;|border-radius:[^;]*;/g, "").replace(/\s+/g, " ").trim();
            if (m.params.type === "error" || m.params.type === "warning" || /Meph|had no effect|failed/i.test(clean)) out(`${m.params.type}: ${clean.slice(0, 600)}`);
        } else if (m.method === "Runtime.exceptionThrown") {
            const d = m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text;
            if (!/Sentry successfully disabled/.test(d)) out(`EXCEPTION: ${d.slice(0, 800)}`);
        }
    });
    await send("Runtime.enable");
    out("watching " + t.url);
    await new Promise(() => { });
} else if (cmd === "reload" || cmd === "extreload") {
    await send("Page.reload", { ignoreCache: true });
    console.log("reloaded");
} else {
    console.log("usage: eval|shot|watch|reload");
}
ws.close();
