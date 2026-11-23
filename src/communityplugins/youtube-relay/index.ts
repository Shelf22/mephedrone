/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { DraftType, showToast, Toasts, UploadHandler } from "@webpack/common";

import { buildRelayEndpoint, isSupportedYouTubeUrl, safeDownloadName } from "./relayClient";

const settings = definePluginSettings({
    relayUrl: {
        type: OptionType.STRING,
        description: "Address of the local relay service",
        default: "http://127.0.0.1:5000",
    },
    relayToken: {
        type: OptionType.STRING,
        description: "Token printed by the relay on first startup",
        default: "",
    },
    timeoutSeconds: {
        type: OptionType.NUMBER,
        description: "Maximum time to wait for a download",
        default: 300,
    },
});

export default definePlugin({
    name: "YouTubeRelay",
    description: "Downloads a YouTube video through a secured local relay and opens Discord's upload prompt.",
    authors: [{ name: "OriBM", id: 0n }],
    tags: ["Commands", "Media", "Utility"],
    settings,

    commands: [
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "d",
            description: "Download a YouTube video through the local relay",
            options: [
                {
                    name: "link",
                    description: "A youtube.com or youtu.be URL",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                },
            ],

            async execute(args, ctx) {
                const input = args[0]?.value;
                if (typeof input !== "string" || !isSupportedYouTubeUrl(input)) {
                    showToast("YouTubeRelay only accepts YouTube URLs.", Toasts.Type.FAILURE);
                    return;
                }

                if (!settings.store.relayToken.trim()) {
                    showToast("Add the local relay token in YouTubeRelay settings first.", Toasts.Type.FAILURE);
                    return;
                }

                const controller = new AbortController();
                const timeoutMs = Math.max(10, settings.store.timeoutSeconds) * 1000;
                const timeout = setTimeout(() => controller.abort(), timeoutMs);

                try {
                    const endpoint = buildRelayEndpoint(settings.store.relayUrl);
                    showToast("YouTubeRelay is downloading the video...", Toasts.Type.MESSAGE);

                    const response = await fetch(endpoint, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "X-Relay-Token": settings.store.relayToken.trim(),
                        },
                        body: JSON.stringify({ url: input }),
                        signal: controller.signal,
                    });

                    if (!response.ok) {
                        const payload = await response.json().catch(() => null) as { error?: string } | null;
                        throw new Error(payload?.error ?? `Relay returned HTTP ${response.status}`);
                    }

                    const blob = await response.blob();
                    const filename = safeDownloadName(response.headers.get("X-Relay-Filename"));
                    const file = new File([blob], filename, { type: "video/mp4" });

                    UploadHandler.promptToUpload([file], ctx.channel, DraftType.ChannelMessage);
                    showToast("Video is ready for upload.", Toasts.Type.SUCCESS);
                } catch (error) {
                    const message = error instanceof Error ? error.message : "Unknown relay error";
                    showToast(`YouTubeRelay failed: ${message}`, Toasts.Type.FAILURE);
                    console.error("[YouTubeRelay]", error);
                } finally {
                    clearTimeout(timeout);
                }
            },
        },
    ],
});
