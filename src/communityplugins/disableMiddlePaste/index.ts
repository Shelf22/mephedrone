/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

function onMouseUp(e: MouseEvent) {
    if (e.button === 1) {
        e.preventDefault();
    }
}

export default definePlugin({
    name: "DisableMiddlePaste",
    description: "Disables middle-click paste so you don't accidentally paste things into the message box on Linux.",
    authors: [Devs.Ven],

    start() {
        window.addEventListener("mouseup", onMouseUp);
    },

    stop() {
        window.removeEventListener("mouseup", onMouseUp);
    },
});
