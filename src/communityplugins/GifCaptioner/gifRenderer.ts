import { Logger } from "@utils/Logger";
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { getLines } from "./utils";
import { renderSpeechbubble } from "./speechbubble";
import { getMaxFileSize, uploadFile } from "./upload";
import { settings } from "./settings";
import { ProgressDisplay } from "./progress";

const logger = new Logger("GifCaptioner");

// Stand-in for the original's bundled "Futura Condensed Extra Bold.otf" -
// swap for a real @font-face if you want an exact visual match, but a
// system condensed/bold font avoids shipping (and licensing) a font binary.
function fontString(size: number) {
    return `900 ${size}px Impact, "Arial Narrow", sans-serif`;
}

export type Transform =
    | { type: "caption"; text: string; size: number }
    | { type: "speechbubble"; tipX: number; tipY: number; tipBase: number };

interface GifRendererOptions {
    progress: ProgressDisplay;
    frames: number;
    width: number;
    height: number;
    transform: Transform;
}

// Uses gifenc (already a Vencord dependency - see node_modules/gifenc)
// instead of the BD original's gif.js. gifenc encodes synchronously on the
// main thread with no Worker script, so there's no worker-URL/CDN-fetch step
// to manage at all - frames are quantized and written to the encoder as soon
// as they arrive.
export class GifRenderer {
    canvas = document.createElement("canvas");
    ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
    topOffset = 0;
    width: number;
    height: number;
    transform: Transform;
    gif = GIFEncoder();
    progress: ProgressDisplay;
    speechBubbleCanvas?: HTMLCanvasElement;
    speechBubbleCtx?: CanvasRenderingContext2D | null;

    constructor({ progress, frames, width, height, transform }: GifRendererOptions) {
        this.progress = progress;
        this.width = width;
        this.height = height;
        this.transform = transform;

        logger.info(`Creating ${width}x${height} gif renderer with ${frames} frames`);

        let fullHeight = height;
        if (transform.type === "caption") {
            this.ctx.font = fontString(transform.size);
            const lines = getLines(this.ctx, transform.text, width);
            fullHeight = lines.length * transform.size + 10 + height;
        }

        const fullSize = fullHeight * width;
        const sizeEstimate = fullSize * frames;
        const maxSize = getMaxFileSize();
        const scaleFactor = Math.max(1, Math.sqrt(sizeEstimate / maxSize));
        logger.info("Scale factor set to", scaleFactor);

        const newWidth = Math.floor(width / scaleFactor);
        const newHeight = Math.floor(height / scaleFactor);
        const newFullHeight = Math.floor(fullHeight / scaleFactor);

        this.width = this.canvas.width = newWidth;
        this.height = newHeight;
        this.canvas.height = newFullHeight;

        if (transform.type === "caption") {
            const newSize = Math.floor(transform.size / scaleFactor);
            this.drawCaption(transform.text, newWidth, newSize);
        } else {
            const newTipX = transform.tipX / scaleFactor;
            const newTipY = transform.tipY / scaleFactor;
            this.drawSpeechBubble(newTipX, newTipY, transform.tipBase);
        }
    }

    // CanvasImageSource covers HTMLVideoElement/HTMLImageElement/HTMLCanvasElement/
    // ImageBitmap/OffscreenCanvas - anything already loaded/decoded in the page that
    // drawImage can read directly, without a separate network fetch of the source.
    addCanvasFrame(source: CanvasImageSource, delay: number) {
        this.ctx.drawImage(source as any, 0, this.topOffset, this.width, this.height);
        this.addFrameToGif(delay * 1000);
    }

    addVideoFrame(frame: VideoFrame) {
        if (!frame.duration) return;
        this.ctx.drawImage(frame as any, 0, this.topOffset, this.width, this.height);
        this.addFrameToGif(frame.duration / 1000);
    }

    private addFrameToGif(delay: number) {
        if (this.transform.type === "speechbubble" && this.speechBubbleCanvas) {
            this.ctx.drawImage(this.speechBubbleCanvas, 0, this.topOffset, this.width, this.height);
        }
        const { data } = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const palette = quantize(data, 256);
        const index = applyPalette(data, palette);
        this.gif.writeFrame(index, this.canvas.width, this.canvas.height, { palette, delay });
    }

    render() {
        this.gif.finish();
        const bytes = this.gif.bytes();
        const file = new File([bytes as BlobPart], "rendered.gif", { type: "image/gif" });
        this.progress.update("Encoding", 1);
        uploadFile(file, settings.store.autoSend);
        this.progress.close();
    }

    private drawCaption(text: string, width: number, size: number) {
        this.ctx.font = fontString(size);
        const lines = getLines(this.ctx, text, width);
        this.topOffset = lines.length * size + 10;
        this.ctx.fillStyle = "white";
        this.ctx.fillRect(0, 0, width, lines.length * size + 10);
        this.ctx.fillStyle = "black";
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "top";
        for (let i = 0; i < lines.length; i++) {
            this.ctx.fillText(lines[i], width / 2, size * i + 5);
        }
    }

    private drawSpeechBubble(tipX: number, tipY: number, tipBase: number) {
        if (!this.speechBubbleCanvas) {
            this.speechBubbleCanvas = document.createElement("canvas");
            this.speechBubbleCanvas.width = this.width;
            this.speechBubbleCanvas.height = this.height;
        }
        if (!this.speechBubbleCtx) this.speechBubbleCtx = this.speechBubbleCanvas.getContext("2d");
        renderSpeechbubble(this.speechBubbleCtx!, this.width, this.height, tipX, tipY, tipBase);
    }
}
