/* eslint-disable simple-header/header -- standalone plugin repo, not Vencord itself */
/*
 * NoiseDFN - DeepFilterNet3 noise suppression for Discord voice.
 * Copyright (c) 2026 FlimixST
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

const candidates = [
    join(__dirname, "../src/userplugins/noisedfn/assets"),
    join(__dirname, "../../src/userplugins/noisedfn/assets"),
    join(process.cwd(), "src/userplugins/noisedfn/assets"),
];

function resolveAsset(name: string): string | null {
    // [MEPHEDRONE] security: plain file names only (no "../" or absolute paths)
    if (!/^[\w.-]+$/.test(String(name)) || String(name).includes("..")) return null;
    for (const dir of candidates) {
        const p = join(dir, name);
        if (existsSync(p)) return p;
    }
    return null;
}

export function getAsset(_e: any, name: string): string | null {
    const p = resolveAsset(name);
    if (!p) return null;
    return readFileSync(p).toString("base64");
}
