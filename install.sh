#!/usr/bin/env bash
# Installs [MEPHEDRONE] into Discord (no sudo). Safe to re-run, e.g. after a Discord update undoes it.
#   ./install.sh            build + install
#   ./install.sh --no-build install the existing dist/
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
cd "$D"

if [ "${1:-}" != "--no-build" ]; then
    echo "== building"
    npx --yes pnpm@12.18.0 install --frozen-lockfile >/dev/null
    npx --yes pnpm@12.18.0 build --disable-updater >/dev/null
fi
[ -f dist/desktop/patcher.js ] || { echo "dist/desktop/patcher.js missing, build first"; exit 1; }

echo "== settings"
python3 - "$HOME/.config" <<'PY'
import json, os, shutil, sys
cfg = sys.argv[1]
old, new = os.path.join(cfg, "Vencord"), os.path.join(cfg, "Mephedrone")
os.makedirs(os.path.join(new, "settings"), exist_ok=True)
os.makedirs(os.path.join(new, "themes"), exist_ok=True)
sp = os.path.join(new, "settings", "settings.json")
first = not os.path.exists(sp)
if first and os.path.isdir(old):
    for sub in ("settings", "themes"):
        src = os.path.join(old, sub)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(new, sub), dirs_exist_ok=True)
    print("   copied your Vencord settings and themes")
if first:
    s = json.load(open(sp)) if os.path.exists(sp) else {}
    p = s.setdefault("plugins", {})
    # privacy pack: turn on the matching stock plugins once
    for name, extra in {
        "ClearURLs": {},
        "AnonymiseFileNames": {},
        "SilentTyping": {"showIcon": True, "isEnabled": False},
        "NoTrack": {"disableAnalytics": True},
    }.items():
        p.setdefault(name, {}).update({"enabled": True, **extra})
    json.dump(s, open(sp, "w"), indent=4)
    print("   privacy plugins enabled (ClearURLs, AnonymiseFileNames, SilentTyping, NoTrack)")
PY

echo "== patching Discord"
python3 - "$D/dist/desktop/patcher.js" <<'PY'
import glob, json, os, re, struct, sys
patcher = sys.argv[1]
apps = sorted(glob.glob(os.path.expanduser("~/.config/discord/app-*/resources")),
              key=lambda p: [int(x) for x in re.findall(r"\d+", p.split("app-")[1].split("/")[0])])
if not apps: sys.exit("Discord not found in ~/.config/discord")
res = apps[-1]
app, orig = os.path.join(res, "app.asar"), os.path.join(res, "_app.asar")
if os.path.exists(app) and os.path.getsize(app) > 4096:   # a real Discord app, not a mod shim
    if os.path.exists(orig): os.remove(orig)
    os.rename(app, orig)
elif os.path.exists(app):
    data = open(app, "rb").read()
    if b"mephedrone" not in data:
        open(app + ".vencord-backup", "wb").write(data)
        print("   saved the old Vencord shim as app.asar.vencord-backup")
if not os.path.exists(orig): sys.exit("Discord's _app.asar is missing; reinstall Discord")

files = {"index.js": f"require({json.dumps(patcher)})".encode(),
         "package.json": b'{"name":"discord","main":"index.js"}'}
header, off = {"files": {}}, 0
for name, body in files.items():
    header["files"][name] = {"size": len(body), "offset": str(off)}
    off += len(body)
js = json.dumps(header, separators=(",", ":")).encode()
pad = (4 - len(js) % 4) % 4
P = len(js) + pad
blob = struct.pack("<4I", 4, P + 8, P + 4, len(js)) + js + b"\0" * pad + b"".join(files.values())
open(app, "wb").write(blob)
print("   installed into", res)
PY

mkdir -p ~/.local/share/applications
cat > ~/.local/share/applications/mephedrone-repair.desktop <<EOF
[Desktop Entry]
Type=Application
Name=[MEPHEDRONE] Repair
Comment=Re-install the Discord client mod after a Discord update
Exec=bash -c '"$D/install.sh" --no-build && notify-send "[MEPHEDRONE]" "Installed. Restart Discord."'
Icon=discord
Terminal=false
Categories=Network;
EOF

echo "OK: fully quit Discord (tray icon > Quit) and open it again."
