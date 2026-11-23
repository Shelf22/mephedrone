#!/usr/bin/env python3
"""Scan .vendor/bd for BetterDiscord plugins: dependencies, security red flags, de-duplication -> .vendor/bd-scan.json"""
import hashlib, json, re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
bd = root / ".vendor/bd"
META = re.compile(r"/\*\*([\s\S]*?)\*/")
TAG = re.compile(r"@(\w+)[ \t]+([^\n\r]+)")
DEPS = {
    "zlib": re.compile(r"ZeresPluginLibrary|0PluginLibrary|ZLibrary|PluginLibrary\.buildPlugin|global\.ZeresPluginLibrary"),
    "bdfdb": re.compile(r"BDFDB"),
    "node": re.compile(r"require\(\s*[\"'](fs|path|child_process|electron|request|https?|os|crypto|net|tls|zlib|vm|worker_threads|original-fs)[\"']\s*\)"),
    "xpui": re.compile(r"window\.require\(|DiscordNative\.fileManager|DiscordNative\.nativeModules"),
}
FLAGS = {
    "token": re.compile(r"getToken\s*\(|AuthenticationStore[\s\S]{0,40}getToken|localStorage[\s\S]{0,40}token|[\"']token[\"']\s*\]|webpackChunkdiscord_app[\s\S]{0,200}getToken", re.I),
    "webhook": re.compile(r"discord(app)?\.com/api/webhooks", re.I),
    "eval": re.compile(r"\beval\s*\(|new Function\s*\(", re.I),
    "obfuscated": re.compile(r"(\\x[0-9a-f]{2}){12,}|atob\s*\(\s*[\"'][A-Za-z0-9+/=]{60,}|_0x[0-9a-f]{4,}", re.I),
    "remote_code": re.compile(r"createElement\(\s*[\"']script|injectScript|import\(\s*[`\"']https?:|\.src\s*=\s*[`\"']https?:[^\"'`]*\.js", re.I),
    "automation": re.compile(r"setInterval[\s\S]{0,300}(updateRemoteSettings|custom_status|setStatus|sendMessage|ackMessage)|selfbot|nitro\s*snip|quest[\s\S]{0,40}(complete|heartbeat)", re.I),
    "selfupdate": re.compile(r"(api\.github\.com|raw\.githubusercontent\.com)[\s\S]{0,400}(writeFile|fs\.|BdApi\.Plugins\.reload|eval)", re.I),
    # stricter malicious-code checks
    "exfil": re.compile(r"(method\s*:\s*[\"']POST[\"'][\s\S]{0,300}https?://(?!(?:[\w-]+\.)?discord(?:app)?\.com)|navigator\.sendBeacon|new WebSocket\(\s*[`\"']wss?://(?!(?:[\w-]+\.)?discord))", re.I),
    "credentials": re.compile(r"\.(email|phone)\b(?!\s*[:=]\s*[\"'])|getCurrentUser\(\)\s*\.\s*(email|phone)|PaymentSourceStore|BillingStore|\bpassword\b\s*[:=]|mfa_?token|authToken", re.I),
    "cookie": re.compile(r"document\.cookie", re.I),
    "charcode": re.compile(r"String\.fromCharCode\((\s*\d+\s*,){15,}", re.I),
}
BOILER = re.compile(r"0PluginLibrary\.plugin\.js|Library (plugin )?(is )?missing|ZeresPluginLibrary[\s\S]{0,200}(download|missing)", re.I)

def node_outside_boilerplate(code):
    anchors = [m.start() for m in BOILER.finditer(code)]
    for m in DEPS["node"].finditer(code):
        if not any(abs(m.start() - a) < 1500 for a in anchors):
            return True
    return False
best = {}
for f in bd.rglob("*.plugin.js"):
    if "node_modules" in f.parts or ".git" in f.parts: continue
    try: code = f.read_text(errors="ignore")
    except Exception: continue
    if len(code) > 600_000: continue
    mb = META.search(code)
    meta = dict(TAG.findall(mb.group(1))) if mb else {}
    name = (meta.get("name") or "").strip()
    if not name: continue
    repo_dir = f.relative_to(bd).parts[0]
    srcf = bd / repo_dir / ".meph-source.json"
    if not srcf.exists(): continue
    src = json.loads(srcf.read_text())
    deps = [k for k, rx in DEPS.items() if rx.search(code) and k != "node"]
    if node_outside_boilerplate(code): deps.append("node")
    flags = [k for k, rx in FLAGS.items() if rx.search(code)]
    hosts = sorted(set(re.findall(r"https?://([a-z0-9.-]+\.[a-z]{2,})", code, re.I)) - {"discord.com", "cdn.discordapp.com", "media.discordapp.net", "github.com", "betterdiscord.app", "raw.githubusercontent.com"})
    entry = {"name": name, "author": meta.get("author", "?"), "version": meta.get("version", "0"), "description": meta.get("description", ""),
             "repo": src["repo"], "license": src["license"], "stars": src["stars"], "path": str(f.relative_to(root)),
             "deps": deps, "flags": flags, "hosts": hosts[:8], "size": len(code), "sha256": hashlib.sha256(code.encode()).hexdigest()}
    prev = best.get(name.lower())
    def score(e): return (not [d for d in e["deps"] if d != "zlib"], e["stars"], e["version"])
    if not prev or score(entry) > score(prev): best[name.lower()] = entry
rows = sorted(best.values(), key=lambda e: e["name"].lower())
json.dump(rows, open(root / ".vendor/bd-scan.json", "w"), indent=1)
from collections import Counter
print(len(rows), "unique BD plugins")
usable = [r for r in rows if not [d for d in r["deps"] if d != "zlib"]]
print("deps:", Counter(d for r in rows for d in r["deps"]))
print("usable (no deps, or only ZeresPluginLibrary):", len(usable), " of which need ZLib:", sum("zlib" in r["deps"] for r in usable))
print("flags among usable:", Counter(f for r in usable for f in r["flags"]))
print("clean usable:", sum(not r["flags"] for r in usable))
