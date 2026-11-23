#!/usr/bin/env python3
"""Find Vencord plugins in .vendor/community, skip ones we already have, and flag risky code.
Writes .vendor/community-scan.json."""
import json, os, re, sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
com = root / ".vendor/community"
NAME = re.compile(r'definePlugin\(\s*\{[\s\S]{0,400}?\bname\s*:\s*["\'`]([^"\'`]+)["\'`]')

def existing_names():
    names = set()
    for d in ["src/plugins", "src/equicordplugins"]:
        for f in (root / d).rglob("index.ts*"):
            m = NAME.search(f.read_text(errors="ignore"))
            if m: names.add(m.group(1).lower())
    return names

# red flags: token grabbing, exfiltration, obfuscation, account-ban automation
FLAGS = {
    "token": re.compile(r"getToken\s*\(|AuthenticationStore[\s\S]{0,40}getToken|localStorage[\s\S]{0,30}token|[\"']token[\"']\s*\]", re.I),
    "webhook": re.compile(r"discord(app)?\.com/api/webhooks", re.I),
    "eval": re.compile(r"\beval\s*\(|new Function\s*\(", re.I),
    "obfuscated": re.compile(r"(\\x[0-9a-f]{2}){12,}|atob\s*\(\s*[\"'][A-Za-z0-9+/=]{60,}|_0x[0-9a-f]{4,}", re.I),
    "automation": re.compile(r"quest[\s\S]{0,40}(complete|progress|heartbeat)|nitro\s*snip|gift[\s\S]{0,20}redeem|selfbot", re.I),
}

have = existing_names()
out, seen = [], set()
for repo in sorted(com.iterdir()):
    if not repo.is_dir(): continue
    meta = json.loads((repo / ".meph-source.json").read_text()) if (repo / ".meph-source.json").exists() else {}
    for idx in repo.rglob("index.ts*"):
        if "node_modules" in idx.parts or ".git" in idx.parts: continue
        src = idx.read_text(errors="ignore")
        m = NAME.search(src)
        if not m: continue
        name = m.group(1)
        pdir = idx.parent
        if name.lower() in have or name.lower() in seen: continue
        if pdir.name.startswith("_"): continue
        code = "\n".join(p.read_text(errors="ignore") for p in pdir.rglob("*") if p.suffix in (".ts", ".tsx", ".js", ".jsx") and "node_modules" not in p.parts)
        flags = [k for k, rx in FLAGS.items() if rx.search(code)]
        hosts = sorted(set(re.findall(r"https?://([a-z0-9.-]+\.[a-z]{2,})", code, re.I)) - {"discord.com", "cdn.discordapp.com", "media.discordapp.net", "github.com"})
        seen.add(name.lower())
        out.append({"name": name, "repo": meta.get("repo", repo.name), "license": meta.get("license", "?"), "dir": str(pdir.relative_to(root)),
                    "flags": flags, "hosts": hosts[:8], "lines": code.count("\n")})
json.dump(out, open(root / ".vendor/community-scan.json", "w"), indent=1)
clean = [p for p in out if not p["flags"]]
print(f"{len(out)} new plugins found, {len(clean)} with no red flags")
from collections import Counter
print(Counter(f for p in out for f in p["flags"]))
