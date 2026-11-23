/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType } from "@api/Commands";
import definePlugin from "@utils/types";

import { rewriteSocialUrl } from "./rewriteUrl";

export default definePlugin({
    name: "FixLink",
    description: "Rewrites supported social-media links to embed-friendly alternatives.",
    authors: [{ name: "OriBM", id: 0n }],
    tags: ["Commands", "Media", "Utility"],

    commands: [
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "f",
            description: "Rewrite a social-media link for a better Discord embed",
            options: [
                {
                    name: "link",
                    description: "An X, Twitter, Instagram, TikTok, or Reddit URL",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                },
            ],

            execute(args) {
                const input = args[0]?.value;
                if (typeof input !== "string") return;

                const rewritten = rewriteSocialUrl(input);
                return {
                    content: rewritten ?? input,
                };
            },
        },
    ],
});
