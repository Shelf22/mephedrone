/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, Toasts } from "@webpack/common";

import { isJpeg, isPng, stripJpeg, stripPng } from "./metadata";

const logger = new Logger("StripExif");

const settings = definePluginSettings({
    notify: {
        type: OptionType.BOOLEAN,
        description: "Show a toast when metadata is removed from an upload",
        default: true,
    },
});

/** events we already processed and re-dispatched */
const processedEvents = new WeakSet<Record<string, any>>();

function isCandidate(file: unknown): file is File {
    return file instanceof File && /^image\/(jpeg|png)$/.test(file.type);
}

async function cleanFile(file: File): Promise<{ file: File; removed: number; } | null> {
    const data = new Uint8Array(await file.arrayBuffer());

    const result = isJpeg(data) ? stripJpeg(data)
        : isPng(data) ? stripPng(data)
            : null;

    if (result === null) {
        // declared image/jpeg or image/png but doesn't parse as one
        Toasts.show({
            id: Toasts.genId(),
            type: Toasts.Type.FAILURE,
            message: `StripExif: could not parse ${file.name}, uploading unmodified!`,
        });
        return null;
    }
    if (result.removed === 0) return null;

    return {
        file: new File(result.parts as BlobPart[], file.name, { type: file.type }),
        removed: result.removed,
    };
}

function interceptUpload(event: Record<string, any>) {
    if (event.type !== "UPLOAD_ATTACHMENT_ADD_FILES" || processedEvents.has(event)) return false;

    const items: Array<{ file: unknown; }> = event.files ?? [];
    if (!items.some(item => isCandidate(item.file))) return false;

    // Stripping requires async file reads, which an interceptor can't await.
    // Swallow the event, clean the files, then re-dispatch the same event.
    (async () => {
        let totalRemoved = 0;
        for (const item of items) {
            if (!isCandidate(item.file)) continue;
            try {
                const cleaned = await cleanFile(item.file);
                if (cleaned) {
                    item.file = cleaned.file;
                    totalRemoved += cleaned.removed;
                }
            } catch (e) {
                logger.error("Failed to strip metadata from", item.file.name, e);
            }
        }

        if (totalRemoved > 0 && settings.store.notify) {
            Toasts.show({
                id: Toasts.genId(),
                type: Toasts.Type.SUCCESS,
                message: `Removed ${totalRemoved} metadata ${totalRemoved === 1 ? "block" : "blocks"} before upload`,
            });
        }

        processedEvents.add(event);
        FluxDispatcher.dispatch(event as any);
    })();

    return true; // block the original event
}

export default definePlugin({
    name: "StripExif",
    description: "Removes EXIF, XMP, IPTC and other metadata (GPS location, camera info, timestamps, ...) from JPEG and PNG images locally before they are uploaded",
    authors: [{ name: "mint", id: 0n }],

    settings,

    start() {
        FluxDispatcher.addInterceptor(interceptUpload);
    },

    stop() {
        const i = FluxDispatcher._interceptors?.indexOf(interceptUpload);
        if (i != null && i !== -1) FluxDispatcher._interceptors.splice(i, 1);
    },
});
