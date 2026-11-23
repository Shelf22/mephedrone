import { Logger } from "@utils/Logger";
import { GifRenderer, Transform } from "./gifRenderer";
import { ProgressDisplay } from "./progress";

const logger = new Logger("GifCaptioner");

// Discord's GIF search results now come from third-party hosts (observed:
// static.klipy.com) that Discord's CSP allows for <video> playback but
// blocks for a plain fetch() - so re-fetching the same URL to demux it
// throws "Refused to connect because it violates the Content Security
// Policy" even though the video is already playing right in front of you.
// Instead of re-fetching, we capture frames directly off the <video>
// element that's already loaded in the editor preview: pause it, seek
// through it, and draw each frame to a canvas. This sidesteps CSP entirely
// since no second network request is made.
const TARGET_FPS = 12;
const MAX_FRAMES = 120;

export async function captionVideo(video: HTMLVideoElement, width: number, height: number, transform: Transform) {
    const progress = new ProgressDisplay("Rendering GIF", "Preparing");
    const wasPlaying = !video.paused;

    try {
        const duration = video.duration;
        if (!isFinite(duration) || duration <= 0) throw new Error("Video has no usable duration");

        let frames = Math.ceil(duration * TARGET_FPS);
        frames = Math.min(frames, MAX_FRAMES);
        const interval = duration / frames;

        video.pause();

        const renderer = new GifRenderer({ progress, frames, width, height, transform });

        for (let i = 0; i < frames; i++) {
            const t = Math.min(i * interval, Math.max(duration - 0.05, 0));
            await seekTo(video, t);
            progress.update("Rendering", i / frames);
            renderer.addCanvasFrame(video, interval);
        }

        renderer.render();
    } catch (e) {
        logger.error("Failed to caption video", e);
        progress.close();
    } finally {
        if (wasPlaying) video.play().catch(() => {});
    }
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            video.removeEventListener("seeked", onSeeked);
            video.removeEventListener("error", onError);
        };
        const onSeeked = () => {
            cleanup();
            resolve();
        };
        const onError = () => {
            cleanup();
            reject(new Error("Video seek failed"));
        };
        video.addEventListener("seeked", onSeeked);
        video.addEventListener("error", onError);
        video.currentTime = time;
    });
}
