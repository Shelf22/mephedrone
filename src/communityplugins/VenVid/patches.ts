/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Caicheng Li
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Verified against the captured Stable web bundle; desktop runtime validation is separate.
export const uploadPatch = {
    find: "Unexpected mismatch between files and file metadata",
    replacement: {
        // Discord's rspack build inlines this as an unnamed function in the module's export list.
        // Name it so intercept can call the original again after compression.
        match: /async function(\(\i,\i,\i\)\{)(?=let\{filesMetadata:)/,
        replace: "async function venVidUpload$1const venVidPending=$self.intercept(venVidUpload,this,arguments);if(venVidPending)return venVidPending;"
    }
};
