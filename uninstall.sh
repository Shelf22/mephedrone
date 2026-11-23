#!/usr/bin/env bash
# Puts Discord back to plain Vencord (or stock Discord if there was no Vencord). Your [MEPHEDRONE] settings stay in ~/.config/Mephedrone.
set -euo pipefail
for res in ~/.config/discord/app-*/resources; do
    if [ -f "$res/app.asar.vencord-backup" ]; then
        mv -f "$res/app.asar.vencord-backup" "$res/app.asar"
        echo "restored Vencord in $res"
    elif [ -f "$res/_app.asar" ] && grep -q mephedrone "$res/app.asar" 2>/dev/null; then
        mv -f "$res/_app.asar" "$res/app.asar"
        echo "restored stock Discord in $res"
    fi
done
rm -f ~/.local/share/applications/mephedrone-repair.desktop
echo "Done. Restart Discord."
