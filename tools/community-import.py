#!/usr/bin/env python3
"""Copy reviewed community plugins into src/communityplugins with their licence + a credits file."""
import json, re, shutil
from pathlib import Path

root = Path(__file__).resolve().parent.parent
EXCLUDE = {"QuestManager", "QuestAutocompleter", "QuestCompleter", "AutoBump", "AutoTranslateTC", "TokenLoginManager",
           "undiscord", "BotClient", "DiscordMCP", "MutualScanner", "Vundiscord", "ChatExporter"}
rows = [r for r in json.load(open(root / ".vendor/community-scan.json")) if r["name"] not in EXCLUDE]
dest = root / "src/communityplugins"
if dest.exists(): shutil.rmtree(dest)
dest.mkdir()
used, credits = set(), []
for r in rows:
    src = root / r["dir"]
    base = src.name
    if base in (".", "src", "plugin", "plugins") or src == root / ".vendor/community" / r["repo"].replace("/", "__"):
        base = re.sub(r"[^A-Za-z0-9]", "", r["name"]) or r["repo"].split("/")[1]
    scope = re.search(r"\.(desktop|discordDesktop|web|vesktop|equibop|dev|browser)$", base)
    stem = base[: scope.start()] if scope else base
    name = base
    i = 2
    while name.lower() in used:
        name = f"{stem}{i}{scope.group(0) if scope else ''}"; i += 1
    used.add(name.lower())
    shutil.copytree(src, dest / name, ignore=shutil.ignore_patterns(".git", "node_modules", "*.md", ".github", "package*.json", "pnpm-lock.yaml"))
    repo_dir = root / ".vendor/community" / r["repo"].replace("/", "__")
    for lic in ("LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"):
        if (repo_dir / lic).exists():
            shutil.copy(repo_dir / lic, dest / name / "LICENSE"); break
    credits.append(f"| {r['name']} | [{r['repo']}](https://github.com/{r['repo']}) | {r['license']} |")
(dest / "CREDITS.md").write_text("# Community plugins\n\nIncluded under their original licences (each folder keeps its LICENSE). Reviewed for token theft, hidden network calls, obfuscation and ban-risk automation before inclusion.\n\n| Plugin | Source | Licence |\n|---|---|---|\n" + "\n".join(credits) + "\n")
print(len(rows), "plugins imported")
