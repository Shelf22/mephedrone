/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 KernelSpecter
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import { useForceUpdater } from "@utils/react";
import { useEffect } from "@webpack/common";

import { formatCountdown } from "../duration";
import { getPending } from "../scheduler";
import { settings } from "../settings";

/** Below this the row turns red, which is your last chance to hit Keep. */
const IMMINENT_MS = 10_000;

export function Countdown({ messageId }: { messageId: string; }) {
    const forceUpdate = useForceUpdater();
    const entry = getPending(messageId);
    const live = entry != null;

    useEffect(() => {
        if (!live) return;

        const handle = setInterval(forceUpdate, 1000);
        return () => clearInterval(handle);
    }, [live, forceUpdate]);

    if (!entry) return null;

    const remaining = entry.deleteAt - Date.now();
    const verb = settings.store.dryRun ? "would delete" : "deletes";

    return (
        <div
            className={classes(
                "vc-autodelete-countdown",
                remaining <= IMMINENT_MS && "vc-autodelete-imminent"
            )}
        >
            <span className="vc-autodelete-dot" />
            {verb} in {formatCountdown(remaining)}
            {entry.reason !== "timer" && <span className="vc-autodelete-reason"> · {entry.reason}</span>}
        </div>
    );
}
