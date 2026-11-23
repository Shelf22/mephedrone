/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Removes metadata (EXIF incl. GPS, XMP, comments, text chunks) from JPEG, PNG and WebP files.
// Pixel data is copied untouched, except JPEGs with a non-default EXIF rotation, which are
// re-encoded so the photo doesn't end up sideways once the rotation tag is gone.

export type StripResult = { bytes: Uint8Array; removed: number; orientation?: number; } | null;

function jpegOrientation(app1: Uint8Array): number {
    // app1 = segment payload starting with "Exif\0\0"
    if (app1.length < 14 || String.fromCharCode(...app1.subarray(0, 4)) !== "Exif") return 1;
    const t = app1.subarray(6);
    const le = t[0] === 0x49;
    const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
    const u16 = (o: number) => dv.getUint16(o, le);
    const u32 = (o: number) => dv.getUint32(o, le);
    const ifd = u32(4);
    if (ifd + 2 > t.length) return 1;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > t.length) break;
        if (u16(e) === 0x0112) return u16(e + 8);
    }
    return 1;
}

function stripJpeg(b: Uint8Array): StripResult {
    if (b[0] !== 0xFF || b[1] !== 0xD8) return null;
    const out: Uint8Array[] = [b.subarray(0, 2)];
    let i = 2, removed = 0, orientation = 1;
    while (i + 4 <= b.length) {
        if (b[i] !== 0xFF) return null;
        const marker = b[i + 1];
        if (marker === 0xDA) { out.push(b.subarray(i)); break; } // start of scan: rest is image data
        if (marker === 0xD9) { out.push(b.subarray(i, i + 2)); break; }
        if (marker >= 0xD0 && marker <= 0xD7 || marker === 0x01) { out.push(b.subarray(i, i + 2)); i += 2; continue; }
        const len = (b[i + 2] << 8) | b[i + 3];
        const seg = b.subarray(i, i + 2 + len);
        const payload = seg.subarray(4);
        // APP1 (EXIF/XMP), APP3–APP15 except APP14 (Adobe colour info), COM
        const drop = marker === 0xE1 || (marker >= 0xE3 && marker <= 0xEF && marker !== 0xEE) || marker === 0xFE;
        if (marker === 0xE1) orientation = Math.max(orientation, jpegOrientation(payload));
        if (drop) removed++;
        else out.push(seg);
        i += 2 + len;
    }
    return { bytes: concat(out), removed, orientation };
}

const PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
const PNG_DROP = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

function stripPng(b: Uint8Array): StripResult {
    if (!PNG_SIG.every((v, i) => b[i] === v)) return null;
    const out: Uint8Array[] = [b.subarray(0, 8)];
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let i = 8, removed = 0;
    while (i + 12 <= b.length) {
        const len = dv.getUint32(i);
        const type = String.fromCharCode(...b.subarray(i + 4, i + 8));
        const end = i + 12 + len;
        if (end > b.length) return null;
        if (PNG_DROP.has(type)) removed++;
        else out.push(b.subarray(i, end));
        i = end;
        if (type === "IEND") break;
    }
    return { bytes: concat(out), removed };
}

function stripWebp(b: Uint8Array): StripResult {
    const tag = (o: number) => String.fromCharCode(...b.subarray(o, o + 4));
    if (b.length < 16 || tag(0) !== "RIFF" || tag(8) !== "WEBP") return null;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const chunks: Uint8Array[] = [];
    let i = 12, removed = 0;
    while (i + 8 <= b.length) {
        const type = tag(i);
        const len = dv.getUint32(i + 4, true);
        const end = i + 8 + len + (len & 1);
        if (end > b.length) return null;
        if (type === "EXIF" || type === "XMP ") removed++;
        else chunks.push(b.slice(i, end));
        i = end;
    }
    if (!removed) return { bytes: b, removed: 0 };
    for (const c of chunks) {
        if (String.fromCharCode(...c.subarray(0, 4)) === "VP8X") c[8] &= ~(0x08 | 0x04); // clear EXIF and XMP flags
    }
    const body = concat(chunks);
    const head = new Uint8Array(12);
    head.set(b.subarray(0, 12));
    new DataView(head.buffer).setUint32(4, body.length + 4, true);
    return { bytes: concat([head, body]), removed };
}

function concat(parts: Uint8Array[]) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
}

async function reencodeUpright(file: File): Promise<Uint8Array | null> {
    // createImageBitmap applies the EXIF rotation by default; drawing it bakes the rotation in.
    const bmp = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.95 });
    return new Uint8Array(await blob.arrayBuffer());
}

/** Returns a cleaned copy of the file, or null if it isn't a supported image or had nothing to remove. */
export async function stripFile(file: File): Promise<{ file: File; removed: number; } | null> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let res: StripResult = null;
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) res = stripJpeg(bytes);
    else if (bytes[0] === 0x89) res = stripPng(bytes);
    else if (bytes[0] === 0x52) res = stripWebp(bytes);
    if (!res || !res.removed) return null;

    let out = res.bytes;
    if (res.orientation && res.orientation !== 1) out = await reencodeUpright(file) ?? out;
    return {
        file: new File([out as BlobPart], file.name, { type: file.type, lastModified: Date.now() }),
        removed: res.removed,
    };
}
