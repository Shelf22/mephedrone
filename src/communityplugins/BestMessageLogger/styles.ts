/*
 * BestMessageLogger, a Vencord plugin by Kh8da
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { disableStyle, enableStyle } from "@api/Styles";

import overlayStyle from "./deleteStyleOverlay.css?managed";
import textStyle from "./deleteStyleText.css?managed";
import { settings } from "./settings";

export function applyDeleteStyle() {
    if (settings.store.deleteStyle === "overlay") {
        disableStyle(textStyle);
        enableStyle(overlayStyle);
    } else {
        disableStyle(overlayStyle);
        enableStyle(textStyle);
    }
}

export function removeDeleteStyle() {
    disableStyle(textStyle);
    disableStyle(overlayStyle);
}
