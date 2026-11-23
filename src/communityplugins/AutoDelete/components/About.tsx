/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 KernelSpecter
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Heading } from "@components/Heading";
import { Link } from "@components/Link";
import { Paragraph } from "@components/Paragraph";

export function About() {
    return (
        <div className="vc-autodelete-about">
            <Heading>Start with one channel</Heading>
            <Paragraph>
                The scope below ships as <b>only where I set a rule</b>, so enabling this plugin
                changes nothing until you say where. Right-click a channel &rarr; <b>Auto-delete here</b>,
                or run <code>/autodelete here 10m</code>. Turn on <b>dry run</b> first if you want to
                watch it decide without it touching anything.
            </Paragraph>

            <Heading>How a message gets spared</Heading>
            <Paragraph>
                Anything containing <code>!keep</code> is never scheduled, and editing that into a
                message that is already counting down calls it off. Pinned messages are skipped.
                The hover bar and the right-click menu both carry a <b>Keep</b> button, and the
                countdown under each pending message turns red for its last ten seconds.
            </Paragraph>

            <Heading>The part worth knowing</Heading>
            <Paragraph>
                A rule of <b>off here</b> is absolute: no timer, and no reply or reaction trigger
                either. The queue survives a restart, and anything that came due while Discord was
                shut is cleared slowly rather than in one burst. Messages that sat in the queue
                longer than the max age are forgotten instead of deleted.
            </Paragraph>

            <Heading>This is still a client mod</Heading>
            <Paragraph>
                Deleting your own messages is a normal client action, and this plugin does it
                through Discord's own request path, one message at a time. Even so, automating
                a user account is against the{" "}
                <Link href="https://discord.com/terms">Terms of Service</Link>. Set sensible
                timers and don't point it at a whole server.
            </Paragraph>
        </div>
    );
}
