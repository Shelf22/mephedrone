/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface StripResult {
    /** Byte ranges of the original file to keep, in order */
    parts: Uint8Array[];
    /** Number of metadata segments/chunks that were removed */
    removed: number;
    /** Bytes saved by the removal */
    savedBytes: number;
}

const JPEG_MAGIC = [0xFF, 0xD8, 0xFF];
const PNG_MAGIC = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

function hasMagic(data: Uint8Array, magic: number[]) {
    return data.length > magic.length && magic.every((b, i) => data[i] === b);
}

export function isJpeg(data: Uint8Array) {
    return hasMagic(data, JPEG_MAGIC);
}

export function isPng(data: Uint8Array) {
    return hasMagic(data, PNG_MAGIC);
}

/**
 * Removes metadata segments from a JPEG without re-encoding.
 *
 * Dropped: APP1 (EXIF incl. GPS, XMP), APP12 (Ducky), APP13 (Photoshop/IPTC),
 * COM (comments), and any trailing bytes after the EOI marker (which can leak
 * pre-crop image data, à la "acropalypse").
 * Kept: APP0 (JFIF), APP2 (ICC color profile), APP14 (Adobe color transform)
 * and all structural segments, so the image renders pixel-identically.
 *
 * Returns null if the file does not parse as a JPEG (caller should keep the
 * original and warn).
 */
export function stripJpeg(data: Uint8Array): StripResult | null {
    if (!isJpeg(data)) return null;

    const DROP = new Set([0xE1 /* APP1 */, 0xEC /* APP12 */, 0xED /* APP13 */, 0xFE /* COM */]);

    const parts: Uint8Array[] = [data.subarray(0, 2)];
    let removed = 0;
    let savedBytes = 0;
    let pos = 2;

    while (pos < data.length) {
        if (data[pos] !== 0xFF) return null;
        // skip fill bytes
        while (pos < data.length && data[pos + 1] === 0xFF) pos++;
        const marker = data[pos + 1];

        // standalone markers (no length field); should not appear here, but be safe
        if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD9)) {
            parts.push(data.subarray(pos, pos + 2));
            pos += 2;
            continue;
        }

        if (pos + 4 > data.length) return null;
        const segLen = 2 + ((data[pos + 2] << 8) | data[pos + 3]);
        const segEnd = pos + segLen;
        if (segLen < 4 || segEnd > data.length) return null;

        if (marker === 0xDA /* SOS */) {
            // Entropy-coded data follows. Inside it, 0xFF is always escaped
            // (FF00) or a restart marker (FFD0-D7), so the first FFD9 found is
            // the real EOI. Cut there to drop any trailing appended data.
            let end = data.length;
            for (let i = segEnd; i < data.length - 1; i++) {
                if (data[i] === 0xFF && data[i + 1] === 0xD9) {
                    end = i + 2;
                    break;
                }
            }
            savedBytes += data.length - end;
            if (end < data.length) removed++;
            parts.push(data.subarray(pos, end));
            return { parts, removed, savedBytes };
        }

        if (DROP.has(marker)) {
            removed++;
            savedBytes += segLen;
        } else {
            parts.push(data.subarray(pos, segEnd));
        }
        pos = segEnd;
    }

    return null; // never reached SOS: not a valid JPEG
}

/**
 * Removes metadata chunks from a PNG without re-encoding.
 *
 * Dropped: eXIf, tEXt, zTXt, iTXt (XMP lives here), tIME, and any trailing
 * bytes after IEND (the "acropalypse" leak).
 * Kept: all structural and color chunks (IHDR, PLTE, IDAT, gAMA, iCCP, sRGB,
 * tRNS, acTL/fcTL/fdAT for APNG, ...), so the image renders identically.
 * Chunk CRCs stay valid because chunks are only removed, never rewritten.
 *
 * Returns null if the file does not parse as a PNG.
 */
export function stripPng(data: Uint8Array): StripResult | null {
    if (!isPng(data)) return null;

    const DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

    const parts: Uint8Array[] = [data.subarray(0, 8)];
    let removed = 0;
    let savedBytes = 0;
    let pos = 8;

    while (pos + 12 <= data.length) {
        const len = (data[pos] << 24 | data[pos + 1] << 16 | data[pos + 2] << 8 | data[pos + 3]) >>> 0;
        const type = String.fromCharCode(data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]);
        const chunkEnd = pos + 12 + len;
        if (chunkEnd > data.length || !/^[A-Za-z]{4}$/.test(type)) return null;

        if (DROP.has(type)) {
            removed++;
            savedBytes += 12 + len;
        } else {
            parts.push(data.subarray(pos, chunkEnd));
        }

        if (type === "IEND") {
            savedBytes += data.length - chunkEnd;
            if (chunkEnd < data.length) removed++;
            return { parts, removed, savedBytes };
        }
        pos = chunkEnd;
    }

    return null; // no IEND: truncated or not a PNG
}
