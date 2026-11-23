/*
 * BestMessageLogger, a Vencord plugin by Kh8da
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelStore, GuildRoleStore } from "@webpack/common";

import { emojiUrl, escapeHtml, resolveUserName, safeUrl } from "./utils";

/**
 * A small Discord markdown renderer for the log menu. It returns safe HTML: every piece of
 * message text is escaped, and generated tags are kept out of the way with placeholders.
 */

export interface RenderContext {
    guildId: string | null;
    mentionNames?: Record<string, string>;
}

const PH_START = "\u0000";
const PH_END = "\u0001";

function roleMention(roleId: string, guildId: string | null): string {
    let role: any = null;
    try {
        if (guildId) role = GuildRoleStore.getRole(guildId, roleId);
    } catch { }
    const name = role?.name ?? "deleted-role";
    const color = role?.colorString;
    const style = color ? ` style="--vc-bml-role:${escapeHtml(color)}"` : "";
    return `<span class="vc-bml-mention vc-bml-roleMention"${style}>@${escapeHtml(name)}</span>`;
}

function channelMention(channelId: string): string {
    let name = "unknown-channel";
    try {
        const channel: any = ChannelStore.getChannel(channelId);
        if (channel?.name) name = channel.name;
    } catch { }
    return `<span class="vc-bml-mention">#${escapeHtml(name)}</span>`;
}

const TIMESTAMP_STYLES: Record<string, Intl.DateTimeFormatOptions> = {
    t: { timeStyle: "short" },
    T: { timeStyle: "medium" },
    d: { dateStyle: "short" },
    D: { dateStyle: "long" },
    f: { dateStyle: "long", timeStyle: "short" },
    F: { dateStyle: "full", timeStyle: "short" }
};

function relativeTime(date: Date): string {
    const diff = (date.getTime() - Date.now()) / 1000;
    const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60], ["second", 1]];
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    for (const [unit, seconds] of units) {
        if (Math.abs(diff) >= seconds || unit === "second") return rtf.format(Math.round(diff / seconds), unit);
    }
    return "";
}

function timestampTag(seconds: string, style = "f"): string {
    const date = new Date(Number(seconds) * 1000);
    if (Number.isNaN(date.getTime())) return escapeHtml(`<t:${seconds}>`);
    const text = style === "R" ? relativeTime(date) : new Intl.DateTimeFormat(undefined, TIMESTAMP_STYLES[style] ?? TIMESTAMP_STYLES.f).format(date);
    return `<span class="vc-bml-timestampTag" title="${escapeHtml(date.toLocaleString())}">${escapeHtml(text)}</span>`;
}

function linkTag(url: string, label?: string): string {
    const href = safeUrl(url);
    if (!href) return escapeHtml(label ?? url);
    return `<a class="vc-bml-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${label ?? escapeHtml(url)}</a>`;
}

function renderInline(text: string, ctx: RenderContext): string {
    const slots: string[] = [];
    const keep = (html: string) => `${PH_START}${slots.push(html) - 1}${PH_END}`;

    let s = text;

    // masked links [label](url)
    s = s.replace(/\[([^\]\n]{1,256})\]\(<?(https?:\/\/[^\s)>]+)>?\)/g, (_m, label, url) => keep(linkTag(url, escapeHtml(label))));
    // custom emojis
    s = s.replace(/<(a?):(\w{1,32}):(\d{15,25})>/g, (_m, animated, name, id) =>
        keep(`<img class="vc-bml-emoji" src="${emojiUrl(id, !!animated)}" alt=":${escapeHtml(name)}:" title=":${escapeHtml(name)}:" loading="lazy" draggable="false" />`));
    // user mentions
    s = s.replace(/<@!?(\d{15,25})>/g, (_m, id) => keep(`<span class="vc-bml-mention">@${escapeHtml(resolveUserName(id, ctx.guildId, ctx.mentionNames))}</span>`));
    // role mentions
    s = s.replace(/<@&(\d{15,25})>/g, (_m, id) => keep(roleMention(id, ctx.guildId)));
    // channel mentions
    s = s.replace(/<#(\d{15,25})>/g, (_m, id) => keep(channelMention(id)));
    // slash command mentions
    s = s.replace(/<\/([\w -]{1,96}):\d{15,25}>/g, (_m, name) => keep(`<span class="vc-bml-mention">/${escapeHtml(name)}</span>`));
    // timestamps
    s = s.replace(/<t:(-?\d{1,13})(?::([tTdDfFR]))?>/g, (_m, secs, style) => keep(timestampTag(secs, style)));
    // @everyone / @here
    s = s.replace(/@(everyone|here)\b/g, (_m, word) => keep(`<span class="vc-bml-mention">@${word}</span>`));
    // bare links
    s = s.replace(/<?(https?:\/\/[^\s<>]+[^\s<>.,:;"')\]!?])>?/g, (_m, url) => keep(linkTag(url)));

    s = escapeHtml(s);

    // inline markdown, applied to escaped text
    s = s
        .replace(/\|\|([\s\S]+?)\|\|/g, '<span class="vc-bml-spoiler" role="button" tabindex="0">$1</span>')
        .replace(/\*\*\*([\s\S]+?)\*\*\*/g, "<strong><em>$1</em></strong>")
        .replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>")
        .replace(/__([\s\S]+?)__/g, "<u>$1</u>")
        .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1<em>$2</em>")
        .replace(/(^|[^\w])_(?!\s)([^_\n]+?)_(?!\w)/g, "$1<em>$2</em>")
        .replace(/~~([\s\S]+?)~~/g, "<s>$1</s>");

    return s.replace(new RegExp(`${PH_START}(\\d+)${PH_END}`, "g"), (_m, i) => slots[Number(i)] ?? "");
}

function renderBlocks(text: string, ctx: RenderContext): string {
    const lines = text.split("\n");
    const out: string[] = [];
    let quote: string[] = [];

    const flushQuote = () => {
        if (!quote.length) return;
        out.push(`<blockquote class="vc-bml-quote">${quote.map(l => renderLine(l, ctx)).join("<br>")}</blockquote>`);
        quote = [];
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith(">>> ")) {
            flushQuote();
            quote = [line.slice(4), ...lines.slice(i + 1)];
            flushQuote();
            break;
        }
        if (line.startsWith("> ") || line === ">") {
            quote.push(line.slice(2));
            continue;
        }
        flushQuote();
        out.push(renderLine(line, ctx, true));
    }
    flushQuote();

    // join plain lines with <br>, block elements already break the line
    let html = "";
    out.forEach((part, i) => {
        const isBlock = part.startsWith("<blockquote") || part.startsWith("<div class=\"vc-bml-h");
        const prevBlock = i > 0 && (out[i - 1].startsWith("<blockquote") || out[i - 1].startsWith("<div class=\"vc-bml-h"));
        if (i > 0 && !isBlock && !prevBlock) html += "<br>";
        html += part;
    });
    return html;
}

function renderLine(line: string, ctx: RenderContext, allowHeadings = false): string {
    if (allowHeadings) {
        const heading = /^(#{1,3}) (.+)$/.exec(line);
        if (heading) return `<div class="vc-bml-h${heading[1].length}">${renderInline(heading[2], ctx)}</div>`;
        const subtext = /^-# (.+)$/.exec(line);
        if (subtext) return `<div class="vc-bml-hsub">${renderInline(subtext[1], ctx)}</div>`;
        const bullet = /^(\s*)[-*] (.+)$/.exec(line);
        if (bullet) return `<span class="vc-bml-bullet" style="--vc-bml-indent:${Math.min(bullet[1].length, 8)}">${renderInline(bullet[2], ctx)}</span>`;
    }
    return renderInline(line, ctx);
}

export function renderMarkdown(source: string, ctx: RenderContext): string {
    if (!source) return "";
    const re = /```(?:([\w+#.-]{1,24})?\n)?([\s\S]*?)```|`([^`\n]+)`/g;
    let html = "";
    let last = 0;
    for (const m of source.matchAll(re)) {
        html += renderBlocks(source.slice(last, m.index), ctx);
        if (m[2] !== undefined) {
            html += `<pre class="vc-bml-codeBlock"><code>${escapeHtml(m[2].replace(/\n$/, ""))}</code></pre>`;
        } else {
            html += `<code class="vc-bml-inlineCode">${escapeHtml(m[3])}</code>`;
        }
        last = m.index! + m[0].length;
    }
    html += renderBlocks(source.slice(last), ctx);
    return html;
}

/** Plain one line preview for list cards: mentions and emojis readable, no markup. */
export function plainPreview(source: string, ctx: RenderContext, max = 140): string {
    const text = readableText(source, ctx)
        .replace(/^\s*(?:#{1,3}|-#|>{1,3}|[-*])\s+/gm, "")
        .replace(/\[([^\]\n]+)\]\((?:<)?https?:\/\/[^\s)>]+>?\)/g, "$1")
        .replace(/[*_~|`]{1,3}/g, "")
        .replace(/\s+/g, " ")
        .trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Message text with mentions, emojis and timestamps turned into readable words. Keeps line breaks. */
export function readableText(source: string, ctx: RenderContext): string {
    return (source || "")
        .replace(/<(a?):(\w{1,32}):\d{15,25}>/g, ":$2:")
        .replace(/<@!?(\d{15,25})>/g, (_m, id) => `@${resolveUserName(id, ctx.guildId, ctx.mentionNames)}`)
        .replace(/<@&(\d{15,25})>/g, (_m, id) => {
            try {
                return `@${(ctx.guildId && GuildRoleStore.getRole(ctx.guildId, id)?.name) || "role"}`;
            } catch {
                return "@role";
            }
        })
        .replace(/<#(\d{15,25})>/g, (_m, id) => {
            try {
                return `#${ChannelStore.getChannel(id)?.name ?? "channel"}`;
            } catch {
                return "#channel";
            }
        })
        .replace(/<t:(-?\d{1,13})(?::[tTdDfFR])?>/g, (_m, secs) => new Date(Number(secs) * 1000).toLocaleString());
}

/** Word level diff for the edit view. Returns [beforeHtml, afterHtml]. */
export function diffWords(before: string, after: string): [string, string] | null {
    const a = before.split(/(\s+)/);
    const b = after.split(/(\s+)/);
    if (a.length * b.length > 250000) return null;

    const n = a.length;
    const m = b.length;
    const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    let i = 0;
    let j = 0;
    let left = "";
    let right = "";
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            left += escapeHtml(a[i]);
            right += escapeHtml(b[j]);
            i++;
            j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            left += /^\s+$/.test(a[i]) ? escapeHtml(a[i]) : `<del class="vc-bml-diffDel">${escapeHtml(a[i])}</del>`;
            i++;
        } else {
            right += /^\s+$/.test(b[j]) ? escapeHtml(b[j]) : `<ins class="vc-bml-diffIns">${escapeHtml(b[j])}</ins>`;
            j++;
        }
    }
    for (; i < n; i++) left += /^\s+$/.test(a[i]) ? escapeHtml(a[i]) : `<del class="vc-bml-diffDel">${escapeHtml(a[i])}</del>`;
    for (; j < m; j++) right += /^\s+$/.test(b[j]) ? escapeHtml(b[j]) : `<ins class="vc-bml-diffIns">${escapeHtml(b[j])}</ins>`;
    return [left, right];
}
