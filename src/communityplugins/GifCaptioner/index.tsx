import definePlugin from "@utils/types";
import { Logger } from "@utils/Logger";
import { openModal, ModalRoot, ModalHeader, ModalContent, ModalFooter, ModalCloseButton } from "@utils/modal";
import { Button, Text } from "@webpack/common";
import { settings } from "./settings";
import { GifDisplayComponent, ExpressionPicker } from "./webpackFinders";
import { formatMediaUrl } from "./utils";
import { captionImage } from "./captionImage";
import { captionVideo } from "./captionVideo";
import { EditGifModal } from "./ui/EditGifModal";
import { CaptionIcon } from "./ui/icons";
import type { Transform } from "./gifRenderer";
import "./styles.css";

const logger = new Logger("GifCaptioner");

let originalRender: any;

// This is the riskiest part of the port - see webpackFinders.ts for why. If
// the caption button never shows up in the GIF/sticker picker, start here:
// log GifDisplayComponent and check whether it resolved to anything.
function patchGifDisplay() {
    if (!GifDisplayComponent?.prototype?.render) {
        logger.warn("Could not find the expression-picker GIF tile component - caption button won't appear.");
        return;
    }
    originalRender = GifDisplayComponent.prototype.render;
    GifDisplayComponent.prototype.render = function (this: any, ...args: any[]) {
        const result = originalRender.apply(this, args);
        try {
            const src = this.props.src;
            const isImage = this.props.format === 1;
            result.props.children.unshift(
                <button
                    className="gc-trigger"
                    onClick={(e: any) => {
                        e.stopPropagation();
                        captionGif(src, isImage);
                    }}
                >
                    <CaptionIcon />
                </button>
            );
        } catch (e) {
            logger.error("Failed to inject caption button", e);
        }
        return result;
    };
}

function unpatchGifDisplay() {
    if (GifDisplayComponent?.prototype && originalRender) {
        GifDisplayComponent.prototype.render = originalRender;
    }
}

function captionGif(src: string, isImage: boolean) {
    const url = formatMediaUrl(src);
    const urlString = url.toString();
    const isWebp = url.pathname.endsWith(".webp");

    if (isImage) {
        const image = document.createElement("img");
        // Must be set before .src - lets us read the loaded image's pixels
        // back out via canvas later (getImageData/toDataURL otherwise throw
        // "canvas has been tainted by cross-origin data"), provided the host
        // sends permissive CORS headers. If it doesn't, the load will fail
        // outright instead of silently tainting - that's the trade we want,
        // since a tainted canvas can't be encoded at all anyway.
        image.crossOrigin = "anonymous";
        image.src = urlString;
        image.addEventListener("load", () => {
            const { width, height } = image;
            showEditModal(width, height, image, transform => {
                const mime = isWebp ? "image/webp" : "image/gif";
                captionImage(image, urlString, width, height, transform, mime);
            });
        });
        image.addEventListener("error", () => logger.error("Failed to load gif"));
    } else {
        const video = document.createElement("video");
        // See the crossOrigin note on the image element above - same reason.
        video.crossOrigin = "anonymous";
        video.src = urlString;
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.load();
        video.addEventListener("canplaythrough", () => {
            const { videoWidth, videoHeight } = video;
            showEditModal(videoWidth, videoHeight, video, transform => {
                captionVideo(video, videoWidth, videoHeight, transform);
            });
        }, { once: true });
        video.addEventListener("error", () => logger.error("Failed to load gif"));
    }
}

function showEditModal(
    width: number,
    height: number,
    element: HTMLElement,
    onConfirm: (transform: Transform) => void
) {
    let submitCallback: (() => Transform) | undefined;

    openModal(props => (
        <ModalRoot {...props}>
            <ModalHeader>
                <Text variant="heading-lg/semibold">Edit GIF</Text>
                <ModalCloseButton onClick={props.onClose} />
            </ModalHeader>
            <ModalContent>
                <EditGifModal
                    width={width}
                    height={height}
                    element={element}
                    onSubmit={cb => (submitCallback = cb)}
                />
            </ModalContent>
            <ModalFooter>
                <Button
                    onClick={() => {
                        try {
                            // @ts-ignore
                            ExpressionPicker?.close?.();
                        } catch {
                            // non-fatal - picker just stays open
                        }
                        const result = submitCallback?.();
                        props.onClose();
                        if (result) onConfirm(result);
                    }}
                >
                    Confirm
                </Button>
            </ModalFooter>
        </ModalRoot>
    ));
}

export default definePlugin({
    name: "GifCaptioner",
    description: "Add a text caption or speech bubble to GIFs/images/videos from the GIF & sticker picker.",
    authors: [{ name: "isnuggs", id: 1483261914392825958n }],
    settings,

    start() {
        patchGifDisplay();
    },

    stop() {
        unpatchGifDisplay();
    }
});
