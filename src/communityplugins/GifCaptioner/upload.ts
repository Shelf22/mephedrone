import { Logger } from "@utils/Logger";
import { RestAPI, ChannelStore, SelectedChannelStore, SelectedGuildStore } from "@webpack/common";
import { AttachFiles, MaxUploadSize } from "./webpackFinders";

const logger = new Logger("GifCaptioner");

export function getMaxFileSize(): number {
    try {
        const guildId = SelectedGuildStore.getGuildId();
        // @ts-ignore - resolved from Discord internals, see webpackFinders.ts
        return MaxUploadSize.maxUploadSize(guildId);
    } catch {
        return 10 * 1024 * 1024; // safe fallback if the lookup fails
    }
}

// NOTE: the original BD plugin attaches the file to the currently open
// composer (so you can review/add text before sending) and, if "auto send"
// is on, drives the composer's own submit handler. Reliably grabbing that
// submit handler requires subclassing an internal editor-events class - a
// fragile pattern even by client-modding standards. Instead, for auto-send
// we POST directly to Discord's own REST message-create endpoint with the
// file as a multipart attachment, which is the same endpoint Discord's own
// client (and every bot library) uses to send a message with a file. This
// is a deliberate deviation from the original, not an oversight - it's more
// robust, at the cost of not being pixel-identical to "drive the UI".
//
// These two paths are mutually exclusive - attachFiles() with
// requireConfirm:true turns out to complete a real send on its own (not just
// stage a draft the way the "attach for manual send" framing suggests), so
// running both for the autoSend case posted the file twice. Pick exactly one.
export async function uploadFile(file: File, autoSend: boolean) {
    const channelId = SelectedChannelStore.getChannelId();
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return;

    if (autoSend) {
        await sendViaRestApi(channelId, file);
        return;
    }

    try {
        // @ts-ignore
        await AttachFiles.attachFiles([file], channel, 0, { requireConfirm: true, origin: "file_picker" });
    } catch (e) {
        logger.error("Failed to attach file to composer", e);
    }
}

async function sendViaRestApi(channelId: string, file: File) {
    try {
        const form = new FormData();
        form.append("payload_json", JSON.stringify({ content: "" }));
        form.append("files[0]", file, file.name);
        await RestAPI.post({ url: `/channels/${channelId}/messages`, body: form as any });
    } catch (e) {
        logger.error("Auto-send failed", e);
    }
}
