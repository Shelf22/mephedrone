import { mapMangledModuleLazy } from "@webpack";

/**
 * Everything in this file hunts Discord's minified internals by searching
 * each module's stringified source for substrings that were present in
 * Discord's client bundle when the original BetterDiscord GifCaptioner
 * plugin was last working. These are Discord-side strings, not BD/Vencord-
 * side, so they should still match today - but Discord changes internals
 * often enough that any one of these can come back undefined on a given
 * client build. Every call site treats these as optional and degrades
 * (button missing / feature skipped) rather than crashing the plugin.
 *
 * If something isn't working, this is the first place to check - log what
 * mapMangledModuleLazy actually resolved and adjust the search strings to
 * match your current Discord build.
 */

export const AttachFiles = mapMangledModuleLazy(
    ["filesMetadata:", "requireConfirm:"],
    {
        attachFiles: m => typeof m === "function" && Function.prototype.toString.call(m).includes("filesMetadata")
    }
);

export const ExpressionPicker = mapMangledModuleLazy(
    ["lastActiveView", "isSearchSuggestion"],
    {
        close: m => typeof m === "function" && Function.prototype.toString.call(m).includes("activeView:null")
    }
);

export const MaxUploadSize = mapMangledModuleLazy(
    ["getUserMaxFileSize", "reType"],
    {
        maxUploadSize: m => typeof m === "function" && Function.prototype.toString.call(m).includes("getUserMaxFileSize")
    }
);

// The tile component that renders a single GIF/sticker inside the
// expression picker (emoji/gif/sticker popup) - this is what we patch to
// inject the caption button. Patched via a runtime prototype wrap (see
// index.tsx patchGifDisplay) rather than a static source patch: a failed
// runtime wrap just means the button doesn't appear, while a failed source
// patch throws during plugin start and can break the whole picker.
export const GifDisplayComponent = mapMangledModuleLazy(
    ["renderGIF()", "imagePool"],
    {
        component: m => typeof m === "function" && !!m.prototype?.renderGIF
    }
).component;
