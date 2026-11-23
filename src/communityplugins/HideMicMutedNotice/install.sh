#!/usr/bin/env bash
#
# install.sh — build Vencord with this plugin and wire it up.
#
# This folder must sit at Vencord/src/userplugins/hideMicMutedNotice/ for the
# build to find it. Idempotent, so re-running is always safe.
#
#   ./install.sh          build and wire up
#   ./install.sh --check  diagnose only, change nothing
#
# SPDX-License-Identifier: GPL-3.0-or-later
set -euo pipefail

# Some setups keep node/pnpm here and it is absent from non-login shells' PATH.
[[ -d "$HOME/.local/bin" ]] && PATH="$HOME/.local/bin:$PATH"

PLUGIN_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
VENCORD_ROOT=$(cd -- "$PLUGIN_DIR/../../.." && pwd)
DIST="$VENCORD_ROOT/dist"
STATE="${XDG_CONFIG_HOME:-$HOME/.config}/vesktop/state.json"

REQUIRED_FILES=(
    vencordDesktopMain.js
    vencordDesktopPreload.js
    vencordDesktopRenderer.js
    vencordDesktopRenderer.css
)

CHECK_ONLY=0
case "${1:-}" in
    --check) CHECK_ONLY=1 ;;
    "")      ;;
    *)       printf 'usage: %s [--check]\n' "$0" >&2; exit 2 ;;
esac

red=$'\033[31m'; green=$'\033[32m'; yellow=$'\033[33m'; bold=$'\033[1m'; off=$'\033[0m'
die()  { printf '%serror:%s %s\n' "$red" "$off" "$*" >&2; exit 1; }
ok()   { printf '  %s✓%s %s\n' "$green" "$off" "$*"; }
bad()  { printf '  %s✗%s %s\n' "$red" "$off" "$*"; }
warn() { printf '  %s!%s %s\n' "$yellow" "$off" "$*"; }
step() { printf '\n%s%s%s\n' "$bold" "$*" "$off"; }

vesktop_running() { pgrep -x vesktop >/dev/null 2>&1; }
read_vencord_dir() {
    [[ -f $STATE ]] || return 0
    python3 -c '
import json,sys
try: print(json.load(open(sys.argv[1])).get("vencordDir") or "")
except Exception: print("")' "$STATE" 2>/dev/null || true
}

# Read the name Vencord will register from the source, so a rename cannot make
# the verification below silently check for the wrong thing.
PLUGIN_NAME=$(grep -m1 -oE 'name:[[:space:]]*"[A-Z][A-Za-z0-9_]*"' "$PLUGIN_DIR/index.ts" \
              | sed -E 's/.*"(.*)"/\1/')
[[ -n $PLUGIN_NAME ]] || die "could not read the plugin name out of index.ts"

# --- sanity ------------------------------------------------------------------

if [[ ! -f "$VENCORD_ROOT/package.json" ]] || ! grep -q '"name": *"vencord"' "$VENCORD_ROOT/package.json" 2>/dev/null; then
    die "this folder is not inside a Vencord checkout.
       It must live at Vencord/src/userplugins/hideMicMutedNotice/ — the build
       only looks there, and the @api/@utils aliases only resolve there.
       Currently at: $PLUGIN_DIR"
fi
[[ $(basename "$(dirname "$PLUGIN_DIR")") == userplugins ]] \
    || die "expected the parent folder to be 'userplugins', got '$(basename "$(dirname "$PLUGIN_DIR")")'"

printf '%sPlugin:%s  %s\n' "$bold" "$off" "$PLUGIN_NAME"
printf '%sVencord:%s %s\n' "$bold" "$off" "$VENCORD_ROOT"

# --- diagnose ----------------------------------------------------------------

if (( CHECK_ONLY )); then
    step "Build output"
    for f in "${REQUIRED_FILES[@]}" package.json; do
        [[ -f "$DIST/$f" ]] && ok "$f" || bad "$f missing"
    done

    if [[ -f "$DIST/vencordDesktopRenderer.js" ]]; then
        step "Compiled into the bundle"
        grep -q "name:\"$PLUGIN_NAME\"" "$DIST/vencordDesktopRenderer.js" \
            && ok "$PLUGIN_NAME" || bad "$PLUGIN_NAME is NOT in the build — rebuild needed"
    fi

    step "Vesktop"
    if [[ -f $STATE ]]; then
        current=$(read_vencord_dir)
        if [[ $current == "$DIST" ]]; then ok "pointed at this build"
        elif [[ -z $current ]]; then bad "no custom Vencord set — Vesktop is using its own bundled copy"
        else bad "pointed elsewhere: $current"
        fi
        vesktop_running && warn "Vesktop is running (quit it before changing the path)" || ok "not running"
    else
        warn "no Vesktop config found; if you use Discord Desktop, run 'pnpm inject' in $VENCORD_ROOT"
    fi
    printf '\nRe-run without --check to fix anything marked %s✗%s.\n' "$red" "$off"
    exit 0
fi

# --- build -------------------------------------------------------------------

command -v pnpm >/dev/null || die "pnpm not found. Install Node 18+ and pnpm, then re-run.
       See https://docs.vencord.dev/installing/custom-plugins/"

# Only the state.json write is unsafe while Vesktop runs: Vesktop rewrites that
# file from memory when it exits and would undo the change. Building is safe.
needs_state_write=0
if [[ -f $STATE ]] && [[ $(read_vencord_dir) != "$DIST" ]]; then
    needs_state_write=1
    vesktop_running && die "Vesktop is running and its Vencord path needs updating.
       Quit it fully first (tray icon → Quit; closing the window only hides it),
       then re-run."
fi

step "Installing dependencies"
if [[ -d "$VENCORD_ROOT/node_modules" ]]; then
    ok "node_modules present"
else
    ( cd "$VENCORD_ROOT" && pnpm install --frozen-lockfile )
fi

step "Building"
( cd "$VENCORD_ROOT" && pnpm build )

# Vencord's build does not emit this, but Vesktop's dist validator requires it.
# Without it Vesktop rejects the folder and quietly downloads stock Vencord.
[[ -f "$DIST/package.json" ]] || echo '{}' > "$DIST/package.json"

step "Verifying"
for f in "${REQUIRED_FILES[@]}" package.json; do
    [[ -f "$DIST/$f" ]] || die "build finished but $f is missing from $DIST"
    ok "$f"
done
grep -q "name:\"$PLUGIN_NAME\"" "$DIST/vencordDesktopRenderer.js" \
    || die "$PLUGIN_NAME did not make it into the bundle"
ok "$PLUGIN_NAME compiled in"

# --- wire it up --------------------------------------------------------------

step "Wiring up"
if [[ ! -f $STATE ]]; then
    warn "No Vesktop config found."
    printf '     If you use Vesktop, launch it once and re-run this script.\n'
    printf '     If you use Discord Desktop, run: cd %q && pnpm inject\n' "$VENCORD_ROOT"
elif (( needs_state_write )); then
    python3 - "$STATE" "$DIST" <<'PY'
import json, os, sys, tempfile
state_path, dist = sys.argv[1], sys.argv[2]
try:
    with open(state_path) as fh:
        state = json.load(fh)
except (FileNotFoundError, json.JSONDecodeError):
    state = {}
state["vencordDir"] = dist
# Atomic replace: a half-written state.json makes Vesktop forget every setting.
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(state_path), suffix=".tmp")
with os.fdopen(fd, "w") as fh:
    json.dump(state, fh, indent=4)
os.replace(tmp, state_path)
print(f"  vencordDir -> {dist}")
PY
    ok "Vesktop now points at this build"
else
    ok "Vesktop already points at this build"
fi

printf '\n%sDone.%s Restart Vesktop, then enable %s under Settings → Plugins.\n' \
    "$green" "$off" "$PLUGIN_NAME"
