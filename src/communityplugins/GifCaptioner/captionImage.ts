import { Logger } from "@utils/Logger";
import { GifRenderer, Transform } from "./gifRenderer";
import { ProgressDisplay } from "./progress";

const logger = new Logger("GifCaptioner");

// Tries a full multi-frame capture first (fetch + WebCodecs ImageDecoder,
// preserves the whole animation) - this works for Discord's own CDN. Third-
// party GIF hosts (see the note in captionVideo.ts) block the fetch via CSP,
// so on failure we fall back to a single-frame capture straight off the
// <img> element that's already loaded: it still produces a captioned image,
// just not an animated one, instead of failing silently.
export async function captionImage(
    image: HTMLImageElement,
    url: string,
    width: number,
    height: number,
    transform: Transform,
    mime: string
) {
    const progress = new ProgressDisplay("Rendering GIF", "Fetching");
    try {
        await captionMultiFrame(url, width, height, transform, mime, progress);
    } catch (e) {
        logger.warn("Multi-frame capture failed (likely a CSP-blocked host) - falling back to a single-frame capture", e);
        try {
            captionSingleFrame(image, width, height, transform, progress);
        } catch (e2) {
            logger.error("Failed to caption image", e2);
            progress.close();
        }
    }
}

async function captionMultiFrame(
    url: string,
    width: number,
    height: number,
    transform: Transform,
    mime: string,
    progress: ProgressDisplay
) {
    const res = await fetch(url);
    const arrayBuffer = await res.arrayBuffer();

    // @ts-ignore - ImageDecoder is part of the WebCodecs API, available in
    // Discord's Chromium/Electron runtime.
    const decoder = new ImageDecoder({ data: arrayBuffer, type: mime });
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (!track) throw new Error("No track found for image");

    const frames = track.frameCount;
    progress.update("Rendering", 0);

    const renderer = new GifRenderer({ progress, frames, width, height, transform });
    for (let i = 0; i < frames; i++) {
        progress.update("Rendering", i / frames);
        const result = await decoder.decode({ frameIndex: i });
        renderer.addVideoFrame(result.image);
        result.image.close();
    }
    renderer.render();
}

function captionSingleFrame(
    image: HTMLImageElement,
    width: number,
    height: number,
    transform: Transform,
    progress: ProgressDisplay
) {
    const renderer = new GifRenderer({ progress, frames: 1, width, height, transform });
    progress.update("Rendering", 0);
    renderer.addCanvasFrame(image, 100);
    renderer.render();
}
