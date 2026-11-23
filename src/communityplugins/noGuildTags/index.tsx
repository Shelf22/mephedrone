/*
* Vencord, a Discord client mod
* Copyright (c) 2025 Vendicated and contributors*
* SPDX-License-Identifier: GPL-3.0-or-later
*/

import definePlugin from "@utils/types";

export default definePlugin({
    name: "NoGuildTags",
    description: "Install this magical plugin and it'll add back the ability to hide guild tags, something that Discord had literally like 2 days ago.",
    authors: [{ name: "noia", id: 0n }],
    start: () => {
        const userThing = Vencord.Webpack.findByProps("getUser");

        if (userThing?.getUser) {
            const originalGetUser = userThing.getUser;

            userThing.getUser = function (e) {
                const user = originalGetUser(e);

                if (user) {
                    user.primaryGuild = null;
                }

                return user;
            };
        }

        //I know I couldve done the typical patches: but the thing is, that did not work for me. (https://i-love.nekos.zip/8KrWiCu10Y.png) Like no matter what I tried, this is literally what I had to resort to :sob:
    }
});