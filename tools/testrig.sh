#!/usr/bin/env bash
# Test Discord in a separate Chromium profile with the fork loaded as an extension (your real Discord is untouched).
#   tools/testrig.sh start      open the window (log in once, ideally with an alt)
#   tools/testrig.sh hide|show  slide the window off-screen / back (no focus stealing while hidden)
#   tools/testrig.sh rebuild    rebuild the extension and reload it in place (session survives)
#   tools/testrig.sh stop
set -euo pipefail
D="$(cd "$(dirname "$0")/.." && pwd)"; T="$D/.test"; mkdir -p "$T"
PORT=9333
stop() { [ -f "$T/pid" ] && kill "$(cat "$T/pid")" 2>/dev/null || true; [ -f "$T/watch.pid" ] && kill "$(cat "$T/watch.pid")" 2>/dev/null || true; rm -f "$T/pid" "$T/watch.pid"; sleep 1; }
start() {
    stop
    local extra=()
    extra=(--window-size=1500,900 --class=meph-testrig --use-fake-ui-for-media-stream --use-fake-device-for-media-stream)
    echo "$1" > "$T/mode"
    chromium --user-data-dir="$T/profile" --remote-debugging-port=$PORT --no-first-run --no-default-browser-check \
        --disable-extensions-except="$D/dist/browser/chromium-unpacked" --load-extension="$D/dist/browser/chromium-unpacked" \
        --mute-audio --disable-background-timer-throttling "${extra[@]}" https://discord.com/app >/dev/null 2>&1 &
    echo $! > "$T/pid"
    for _ in $(seq 40); do curl -s "localhost:$PORT/json" | grep -q discord.com && break; sleep 0.5; done
    : > "$T/console.log"
    node "$D/tools/cdp.mjs" watch "$T/console.log" >/dev/null 2>&1 & echo $! > "$T/watch.pid"
    echo "rig up ($1), console -> $T/console.log"
}
win() { xdotool search --pid "$(cat "$T/pid")" --onlyvisible --class chromium 2>/dev/null | tail -1; }
case "${1:-}" in
    start) start start ;;
    hide) w=$(win); [ -n "$w" ] && xdotool windowminimize "$w" && echo hidden ;;
    show) w=$(win); [ -n "$w" ] && xdotool windowactivate "$w" && echo shown ;;
    rebuild) (cd "$D" && npx --yes pnpm@12.18.0 buildWeb --dev >/dev/null) && node "$D/tools/cdp.mjs" extreload ;;
    stop) stop; echo stopped ;;
    *) echo "usage: $0 start|headless|rebuild|stop" ;;
esac
