// Documentation fixtures only: no Discord connection, real messages, or notifications.
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const docs = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(docs);
const checkout = process.env.EQUICORD_PATH || path.join(homedir(), "Equicord");
const require = createRequire(path.join(checkout, "package.json"));
const runtime = process.env.DOCS_RUNTIME || path.join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node");
const runtimeRequire = createRequire(path.join(runtime, "package.json"));
const { chromium } = runtimeRequire("playwright");
const { build } = require("esbuild");
const notification = path.join(checkout, "src/api/Notifications/NotificationComponent.tsx");
const fixtures = {
    "@api/Settings": `export const definePluginSettings = x => x; export const useSettings = () => ({notifications:{timeout:5000,position:'bottom-right'}});`,
    "@components/ErrorBoundary": `export default {wrap: x => x};`,
    "@utils/css": `export const classNameFactory = prefix => (...names) => names.map(x => prefix+x).join(' ');`,
    "@utils/react": `export const useTimer = () => {};`,
    "@utils/types": `export default x => x; export const OptionType = {BOOLEAN:1};`,
    "@utils/misc": `export const classes = (...x) => x.filter(Boolean).join(' ');`,
    "@webpack/common": `export const ChannelStore={}, MessageStore={}, ReadStateStore={}, UserStore={getCurrentUser:()=>({id:'self'})}; export const Tooltip=({text,children})=>children({title:text}); export const useStateFromStores=(_,selector)=>selector(); export const React={}; export const useEffect=()=>{}; export const useRef=x=>({current:x}); export const useState=x=>[x,()=>{}];`,
    "./activity": `export const ActivityStore={enabled:true,getActivity:id=>globalThis.demoActivities[id]}; export const pinnedIds=()=>Object.keys(globalThis.demoActivities);`,
    "./reminders": `export const reconnect=()=>{}, refresh=()=>{}, startReminders=()=>{}, stopReminders=()=>{};`
};
const bundle = await build({
    stdin: {contents:`import plugin from './index'; import Notification from ${JSON.stringify(notification)}; globalThis.demoPlugin=plugin; globalThis.demoNotification=Notification;`,resolveDir:root},
    bundle:true,write:false,format:"iife",platform:"browser",loader:{".css":"empty"},jsxFactory:"globalThis.demoElement",
    plugins:[{name:"documentation-fixtures",setup(b){
        b.onResolve({filter:/./},a=>a.path in fixtures ? {path:a.path,namespace:"demo"} : undefined);
        b.onLoad({filter:/.*/,namespace:"demo"},a=>({contents:fixtures[a.path]}));
    }}]
});
const badgeCss = await readFile(path.join(root,"style.css"),"utf8");
const notificationCss = await readFile(path.join(checkout,"src/api/Notifications/styles.css"),"utf8");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Alzheimer — documentation demo</title>
<style>
:root{--text-muted:#a9aab2;--text-default:#d9d9e0;--text-strong:#f2f3f5;--background-base-low:#292a31;--brand-500:#8b75ff;--status-positive:#23a55a;--status-warning:#f0b232;--status-danger:#f23f43;--interactive-icon-default:#b8bac4}
*{box-sizing:border-box}body{margin:0;background:#17181e;color:#ececf1;font-family:Arial,sans-serif;padding:44px}h1{font-size:32px;margin:14px 0}h2{font-size:18px;margin:0}p{color:#b4b5c0;font-size:15px;line-height:1.6}.tag{font-size:11px;letter-spacing:1.5px;color:#b9aaff;font-weight:bold}.subtitle{margin-bottom:28px}.layout{display:grid;grid-template-columns:390px 1fr;gap:30px}.sidebar{background:#22232b;border:1px solid #373944;border-radius:14px;padding:20px}.category{font-size:12px;color:#b8bac8;text-transform:uppercase;letter-spacing:1px;margin:10px 0 12px}.row{display:flex;align-items:center;gap:12px;padding:12px 8px;height:60px;border-radius:7px}.row:hover{background:#30313a}.avatar{width:32px;height:32px;border-radius:50%;background:#484265;display:grid;place-items:center;color:#e0daff;font-size:12px}.name{flex:1;font-size:15px;font-weight:600}.ordinary{opacity:.6;border-top:1px solid #41424e;margin-top:8px;padding-top:8px}.explanation{padding:8px 0}.detail{padding:10px 0 15px;border-bottom:1px solid #343640}.detail strong{font-size:15px}.detail p{margin:5px 0;font-size:14px}.footer{margin-top:24px;font-size:12px;color:#9a9ca9}.notification-stage{height:245px;background:#22232b;border:1px solid #373944;border-radius:14px;position:relative;padding:24px}.notification-stage p{max-width:360px}.vc-notification-root:not(.vc-notification-log-wrapper > .vc-notification-root){width:400px!important;bottom:24px!important;right:24px!important;min-height:100px}.vc-notification-title{margin:0}.notification-stage .hint{font-size:13px;position:absolute;bottom:26px;left:24px}.notification-page{display:none}
${badgeCss}\n${notificationCss}
</style>
<section id="activity-page"><div class="tag">DOCUMENTATION DEMO · FICTIONAL CONTACTS · SIMULATED AGES</div><h1>Your pinned conversations, at a glance</h1><p class="subtitle">Badges below are rendered from the Alzheimer plugin component. The surrounding DM list is a simplified demo.</p><div class="layout"><div class="sidebar"><div class="category">⌄ Friends · manually ordered</div><div id="rows"></div><div class="ordinary"><div class="category">Direct messages</div><div class="row"><span class="avatar">J</span><span class="name">Jamie</span></div></div></div><div class="explanation"><div class="detail"><strong>12 hours ago · Neutral</strong><p>Less than 24 hours since the latest message.</p></div><div class="detail"><strong style="color:#23a55a">24 hours ago · Green</strong><p>24 to under 48 hours. No reminders yet.</p></div><div class="detail"><strong style="color:#f0b232">52 hours ago · Yellow + reply arrow</strong><p>Anna sent the latest message. Reminders are eligible.</p></div><div class="detail"><strong style="color:#f23f43">72 hours ago · Red</strong><p>The reply arrow can remain, but reminders stop.</p></div><div class="detail"><strong>Yellow without an arrow</strong><p>You sent the latest message. No reminder.</p></div><div class="detail"><strong>Yellow with an unknown sender</strong><p>No arrow or reminder until Discord confirms the sender.</p></div></div></div><div class="footer">Hover a badge for its timestamp and reply tooltip. Opening a DM does not reset its age.</div></section>
<section class="notification-page" id="notification-page"><div class="tag">DOCUMENTATION DEMO · SIMULATED IN-APP NOTIFICATION</div><h1>A reminder when a reply is due</h1><p class="subtitle">The shared Equicord notification component, rendered with fictional reminder data.</p><div class="notification-stage"><h2>Yellow + waiting for your reply</h2><p>First reminder at 48 hours.<br>Repeat every two hours while eligible.<br>Stop at 72 hours or after a new message.</p><div class="hint">In Discord, clicking the reminder opens Anna's DM.</div><div id="notification"></div></div><div class="footer">Desktop notification appearance depends on Windows. This demo does not send a notification or open Discord.</div></section>
<script>
globalThis.demoElement=(type,props,...children)=>{const p={...props,children:children.length===1?children[0]:children};if(typeof type==='function')return type(p);const node=document.createElementNS(type==='svg'||type==='path'?'http://www.w3.org/2000/svg':'http://www.w3.org/1999/xhtml',type);for(const [key,value] of Object.entries(props||{})){if(key==='style')Object.assign(node.style,value);else if(key.startsWith('on'))continue;else if(value!=null&&value!==false)node.setAttribute(key==='className'?'class':key,String(value));}const append=x=>{if(Array.isArray(x))x.forEach(append);else if(x!=null&&x!==false)node.append(x instanceof Node?x:document.createTextNode(String(x)));};children.forEach(append);return node;};
globalThis.demoActivities={};
${bundle.outputFiles[0].text}
const examples=[['Alex',12,'friend'],['Ben',24,'self'],['Anna',52,'friend'],['Chris',72,'friend'],['Dana',52,'self'],['Morgan',48,undefined]];
examples.forEach(([name,age,authorId],i)=>{const id='demo-'+i;demoActivities[id]={messageId:id,timestamp:Date.now()-age*3600000,authorId};const row=document.createElement('div');row.className='row';row.innerHTML='<span class="avatar">'+name[0]+'</span><span class="name">'+name+'</span>';row.append(demoPlugin.renderMemberListDecorator({type:'dm',channel:{id,isDM:()=>true}}));document.getElementById('rows').append(row);});
document.getElementById('notification').append(demoNotification({title:'Anna is waiting for your reply',body:'Your last exchange was 52 hours ago.',onClose:()=>{},onClick:()=>{}}));
if(location.hash==='#notification'){document.getElementById('activity-page').style.display='none';document.getElementById('notification-page').style.display='block';}
</script></html>`;
await mkdir(path.join(docs,"screenshots"),{recursive:true});
await writeFile(path.join(docs,"demo.html"),html);
const browser = await chromium.launch({headless:true,executablePath:process.env.DOCS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe"});
try {
    const page = await browser.newPage({viewport:{width:1100,height:760},deviceScaleFactor:2});
    const errors=[];
    page.on("pageerror",e=>errors.push(e.message));
    const url=pathToFileURL(path.join(docs,"demo.html")).href;
    await page.goto(url);
    if(await page.locator('.vc-alzheimer-badge').count()!==6)throw new Error("Expected six actual plugin badges.");
    await page.screenshot({path:path.join(docs,"screenshots/05-activity-demo.png"),fullPage:true});
    await page.setViewportSize({width:1100,height:515});
    await page.goto(url+'#notification');
    await page.reload();
    await page.screenshot({path:path.join(docs,"screenshots/06-reminder-demo.png"),fullPage:true});
    if(errors.length)throw new Error(errors.join('\n'));
    console.log("Rendered six plugin badges and the shared notification component. Two documentation screenshots saved.");
} finally { await browser.close(); }
