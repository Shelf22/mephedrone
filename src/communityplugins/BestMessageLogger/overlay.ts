/*
 * BestMessageLogger, a Vencord plugin by Kh8da
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { copyToClipboard } from "@utils/clipboard";
import { openUserProfile } from "@utils/discord";
import { saveFile } from "@utils/web";
import { FluxDispatcher, MessageStore, NavigationRouter, showToast, UserStore, UserUtils } from "@webpack/common";

import { diffWords, plainPreview, readableText, RenderContext, renderMarkdown } from "./markdown";
import { settings } from "./settings";
import { clearTab, entries, entryMessage, entryTime, exportJson, getEntry, getSavedMediaBlob, getVersion, onLogsChanged, removeEntries } from "./store";
import type { LogEmbed, LogEntry, LogMedia, LogMessage, Scope, Tab } from "./types";
import { discordMediaUrl, escapeHtml, formatBytes, formatDate, formatShort, getChannelLabel, getGuildInfo, isDmMessage, logger, messageLink, safeUrl, userAvatarUrl } from "./utils";

const BRAND_NAME = "Kh8da";
const BRAND_LINK = "https://kh8da.com";
const BRAND_LABEL = "kh8da.com";
const BRAND_USER_ID = "508044811345854495";

const BRAND_MARK = '<span class="vc-bml-brandMark">K</span>';

function brandAvatarImg(avatar: string): string {
    return `<img class="vc-bml-brandAvatar" src="${escapeHtml(userAvatarUrl(BRAND_USER_ID, avatar))}" alt="" draggable="false" />`;
}

/** Kh8da's Discord avatar from Discord's own CDN, or a letter badge when it can't be shown. */
function brandAvatarHtml(): string {
    let user: any = null;
    try { user = UserStore.getUser(BRAND_USER_ID); } catch { }
    return user?.avatar ? brandAvatarImg(user.avatar) : BRAND_MARK;
}

/** Fetches the profile when Discord hasn't loaded it yet, then swaps the letter badge for the avatar. */
function loadBrandAvatar(root: HTMLElement) {
    const mark = root.querySelector(".vc-bml-brandMark");
    if (!mark) return;
    UserUtils.getUser(BRAND_USER_ID).then((user: any) => {
        if (user?.avatar && mark.isConnected) mark.outerHTML = brandAvatarImg(user.avatar);
    }).catch(() => { });
}

function openBrandProfile() {
    closeOverlay();
    openUserProfile(BRAND_USER_ID).catch(e => {
        logger.error("Opening the profile failed", e);
        showToast({ text: "Could not open the profile.", variant: "critical" });
    });
}

const CHUNK_SIZE = 60;
const SEARCH_DELAY = 90;

const ICONS = {
    logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    jump: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="14" height="14" rx="2"/><path d="m22 8-6 4 6 4z"/></svg>',
    audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    forward: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 17 5-5-5-5"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>',
    at: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></svg>',
    dm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>'
};

const TAB_LABELS: Record<Tab, string> = { deleted: "Deleted", edited: "Edits", ghostPings: "Ghost Pings" };

type Row = { type: "day"; label: string; } | { type: "group"; id: string; name: string; iconUrl: string | null; acronym: string; count: number; dm: boolean; } | { type: "card"; entry: LogEntry; };

interface Elements {
    root: HTMLDivElement;
    win: HTMLDivElement;
    list: HTMLDivElement;
    detail: HTMLDivElement;
    search: HTMLInputElement;
    lightbox: HTMLDivElement;
}

let els: Elements | null = null;
let isOpen = false;
let tab: Tab = "deleted";
let scope: Scope = "all";
let query = "";
let selectedKey: string | null = null;
const collapsedGroups = new Set<string>();

let visibleEntries: LogEntry[] = [];
let rows: Row[] = [];
let renderedRows = 0;
let renderedVersion = -1;
let detailFor: { entry: LogEntry | null; saved: number; } = { entry: null, saved: -1 };
let detailToken = 0;
let objectUrls: string[] = [];
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let refreshFrame = 0;
let clearArmedUntil = 0;
let unsubscribeLogs: (() => void) | null = null;
const searchTextCache = new WeakMap<LogEntry, string>();

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------

export function isOverlayOpen() {
    return isOpen;
}

export function toggleOverlay() {
    if (isOpen) closeOverlay();
    else openOverlay();
}

export function openOverlay(focusKey?: string) {
    if (focusKey) {
        const entry = getEntry(focusKey);
        if (entry) {
            tab = entry.tab;
            selectedKey = focusKey;
            query = "";
            scope = "all";
        }
    }

    if (isOpen && els) {
        if (focusKey) refresh(true);
        return;
    }

    isOpen = true;
    els = buildShell();
    unsubscribeLogs = onLogsChanged(scheduleRefresh);
    refresh(true);

    requestAnimationFrame(() => {
        els?.root.classList.add("vc-bml-open");
        els?.search.focus({ preventScroll: true });
    });
}

export function closeOverlay() {
    if (!isOpen || !els) return;
    isOpen = false;
    unsubscribeLogs?.();
    unsubscribeLogs = null;
    if (searchTimer) clearTimeout(searchTimer);
    cancelAnimationFrame(refreshFrame);
    refreshFrame = 0;

    const { root } = els;
    els = null;
    root.classList.remove("vc-bml-open");
    root.classList.add("vc-bml-closing");
    const done = () => {
        root.remove();
        revokeObjectUrls();
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) done();
    else setTimeout(done, 170);
    detailFor = { entry: null, saved: -1 };
    renderedVersion = -1;
}

/** Called by the plugin on stop. */
export function destroyOverlay() {
    closeOverlay();
    document.getElementById("vc-bml-root")?.remove();
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function buildShell(): Elements {
    document.getElementById("vc-bml-root")?.remove();

    const root = document.createElement("div");
    root.id = "vc-bml-root";
    root.innerHTML = `
        <div class="vc-bml-backdrop" data-action="close"></div>
        <div class="vc-bml-window" role="dialog" aria-modal="true" aria-label="BestMessageLogger">
            <header class="vc-bml-header">
                <div class="vc-bml-logo">${ICONS.logo}</div>
                <div class="vc-bml-titleWrap">
                    <div class="vc-bml-title">BestMessageLogger</div>
                    <div class="vc-bml-sub">Deleted messages, edits and ghost pings</div>
                </div>
                <div class="vc-bml-headerActions">
                    <button class="vc-bml-btn" data-action="export" title="Save every log as a JSON file">${ICONS.download}<span>Export</span></button>
                    <button class="vc-bml-btn vc-bml-danger" data-action="clear" title="Remove every entry in this tab">${ICONS.trash}<span class="vc-bml-clearLabel">Clear tab</span></button>
                    <button class="vc-bml-iconBtn" data-action="close" title="Close (Esc)" aria-label="Close">${ICONS.close}</button>
                </div>
            </header>
            <div class="vc-bml-toolbar">
                <div class="vc-bml-tabs" role="tablist">
                    ${(Object.keys(TAB_LABELS) as Tab[]).map(t => `<button class="vc-bml-tab" role="tab" data-tab="${t}">${TAB_LABELS[t]}<span class="vc-bml-count" data-count="${t}">0</span></button>`).join("")}
                </div>
                <div class="vc-bml-toolbarRow">
                    <div class="vc-bml-segment" role="radiogroup" aria-label="Show">
                        <button data-scope="all">All</button>
                        <button data-scope="servers">Servers</button>
                        <button data-scope="dms">DMs</button>
                    </div>
                    <label class="vc-bml-searchWrap">
                        ${ICONS.search}
                        <input class="vc-bml-search" type="text" spellcheck="false" autocomplete="off" placeholder="Search messages, people, servers, channels or files" />
                        <button class="vc-bml-searchClear" data-action="clear-search" title="Clear search" aria-label="Clear search">${ICONS.close}</button>
                    </label>
                </div>
            </div>
            <div class="vc-bml-body">
                <div class="vc-bml-list" role="listbox" tabindex="-1"></div>
                <div class="vc-bml-detail"></div>
            </div>
            <footer class="vc-bml-footer">
                <div class="vc-bml-hints">
                    <span><kbd>${escapeHtml(settings.store.openHotkey || "Ctrl+Shift+I")}</kbd> open</span>
                    <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
                    <span><kbd>Esc</kbd> close</span>
                </div>
                <div class="vc-bml-brandWrap">
                    <button class="vc-bml-brand" data-action="profile" title="Open ${BRAND_NAME}'s Discord profile">
                        ${brandAvatarHtml()}
                        <span>Made by ${BRAND_NAME}</span>
                    </button>
                    <a class="vc-bml-brandLink" href="${BRAND_LINK}" target="_blank" rel="noreferrer noopener" title="Open ${BRAND_LABEL}">${BRAND_LABEL}</a>
                </div>
            </footer>
            <div class="vc-bml-lightbox" hidden></div>
        </div>`;

    document.body.appendChild(root);

    const elements: Elements = {
        root,
        win: root.querySelector(".vc-bml-window")!,
        list: root.querySelector(".vc-bml-list")!,
        detail: root.querySelector(".vc-bml-detail")!,
        search: root.querySelector(".vc-bml-search")!,
        lightbox: root.querySelector(".vc-bml-lightbox")!
    };

    elements.search.value = query;
    root.classList.toggle("vc-bml-hasQuery", !!query);

    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onKeyDown);
    // keep Discord from reacting to keys typed inside the menu
    for (const type of ["keyup", "keypress", "paste", "copy", "cut"]) {
        root.addEventListener(type, e => e.stopPropagation());
    }
    elements.search.addEventListener("input", onSearchInput);
    root.querySelector(".vc-bml-brandAvatar")?.addEventListener("error", e => {
        (e.target as HTMLElement).outerHTML = BRAND_MARK;
    });
    loadBrandAvatar(root);
    elements.list.addEventListener("scroll", onListScroll, { passive: true });
    // media that can't load anymore gets a placeholder (error events don't bubble, so capture)
    elements.detail.addEventListener("error", onMediaError, true);

    return elements;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

function contextFor(message: LogMessage): RenderContext {
    return { guildId: message.guildId, mentionNames: message.mentionNames };
}

function placeText(message: LogMessage) {
    const guild = getGuildInfo(message.guildId, message.guildName, message.guildIconUrl);
    return `${guild?.name ?? "Direct Messages"} ${getChannelLabel(message.channelId, message.channelName)}`;
}

function messageSearchText(message: LogMessage): string {
    const ctx = contextFor(message);
    return [
        message.author.name,
        message.author.username,
        readableText(message.content, ctx),
        message.extraText.join(" "),
        message.forwarded?.content ?? "",
        message.media.map(m => m.filename).join(" "),
        message.embeds.map(e => `${e.title} ${e.description} ${e.authorName} ${e.footerText} ${e.fields.map(f => `${f.name} ${f.value}`).join(" ")}`).join(" "),
        placeText(message)
    ].join(" ");
}

function searchTextOf(entry: LogEntry): string {
    let text = searchTextCache.get(entry);
    if (text == null) {
        text = (entry.tab === "edited"
            ? `${messageSearchText(entry.after)} ${readableText(entry.before.content, contextFor(entry.before))}`
            : messageSearchText(entry.message)
        ).toLowerCase();
        searchTextCache.set(entry, text);
    }
    return text;
}

function computeVisible() {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    visibleEntries = (entries[tab] as LogEntry[]).filter(entry => {
        if (scope !== "all") {
            const dm = isDmMessage(entryMessage(entry));
            if (scope === "dms" ? !dm : dm) return false;
        }
        if (!terms.length) return true;
        const text = searchTextOf(entry);
        return terms.every(t => text.includes(t));
    });

    rows = [];
    if (scope === "servers") {
        const groups = new Map<string, LogEntry[]>();
        for (const entry of visibleEntries) {
            const id = entryMessage(entry).guildId ?? "unknown";
            let list = groups.get(id);
            if (!list) groups.set(id, list = []);
            list.push(entry);
        }
        for (const [id, list] of groups) {
            const m = entryMessage(list[0]);
            const guild = getGuildInfo(m.guildId, m.guildName, m.guildIconUrl);
            rows.push({ type: "group", id, name: guild?.name ?? "Unknown server", iconUrl: guild?.iconUrl ?? null, acronym: guild?.acronym ?? "?", count: list.length, dm: false });
            if (!collapsedGroups.has(id)) for (const entry of list) rows.push({ type: "card", entry });
        }
    } else {
        let lastDay = "";
        for (const entry of visibleEntries) {
            const label = dayLabel(entryTime(entry));
            if (label !== lastDay) {
                rows.push({ type: "day", label });
                lastDay = label;
            }
            rows.push({ type: "card", entry });
        }
    }

    if (selectedKey && !visibleEntries.some(e => e.key === selectedKey)) selectedKey = null;
    if (!selectedKey && visibleEntries.length) selectedKey = visibleEntries[0].key;
}

const dayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
const dayYearFormatter = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" });

function dayLabel(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "Unknown date";
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (d.getTime() >= start) return "Today";
    if (d.getTime() >= start - 86400000) return "Yesterday";
    return d.getFullYear() === now.getFullYear() ? dayFormatter.format(d) : dayYearFormatter.format(d);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function scheduleRefresh() {
    if (!isOpen || refreshFrame) return;
    refreshFrame = requestAnimationFrame(() => {
        refreshFrame = 0;
        refresh(false);
    });
}

/** Redraws counts, list and detail. `reset` scrolls the list back to the top. */
function refresh(reset: boolean) {
    if (!els) return;
    renderedVersion = getVersion();

    for (const t of Object.keys(TAB_LABELS) as Tab[]) {
        const count = els.root.querySelector<HTMLElement>(`[data-count="${t}"]`);
        if (count) count.textContent = String(entries[t].length);
        els.root.querySelector(`[data-tab="${t}"]`)?.classList.toggle("vc-bml-active", t === tab);
        els.root.querySelector(`[data-tab="${t}"]`)?.setAttribute("aria-selected", String(t === tab));
    }
    els.root.querySelectorAll<HTMLElement>("[data-scope]").forEach(btn => {
        btn.classList.toggle("vc-bml-active", btn.dataset.scope === scope);
        btn.setAttribute("aria-checked", String(btn.dataset.scope === scope));
    });

    computeVisible();
    renderList(reset);
    renderDetail();
}

function renderList(reset: boolean) {
    if (!els) return;
    const { list } = els;
    const scrollTop = reset ? 0 : list.scrollTop;
    const keep = reset ? 0 : renderedRows;

    if (!rows.length) {
        list.innerHTML = emptyListHtml();
        renderedRows = 0;
        return;
    }

    let target = Math.max(CHUNK_SIZE, keep);
    // make sure the selected card is rendered
    if (selectedKey) {
        const index = rows.findIndex(r => r.type === "card" && r.entry.key === selectedKey);
        if (index >= target) target = index + CHUNK_SIZE;
    }
    renderedRows = Math.min(rows.length, target);
    list.innerHTML = rows.slice(0, renderedRows).map(rowHtml).join("") + moreHtml();
    list.scrollTop = scrollTop;
    if (reset) scrollSelectedIntoView();
}

function renderMoreRows() {
    if (!els || renderedRows >= rows.length) return;
    const next = Math.min(rows.length, renderedRows + CHUNK_SIZE);
    const html = rows.slice(renderedRows, next).map(rowHtml).join("");
    renderedRows = next;
    els.list.querySelector(".vc-bml-more")?.remove();
    els.list.insertAdjacentHTML("beforeend", html + moreHtml());
}

function moreHtml() {
    return renderedRows < rows.length ? "<div class=\"vc-bml-more\">Loading more…</div>" : "";
}

function onListScroll() {
    if (!els) return;
    const { list } = els;
    if (list.scrollTop + list.clientHeight > list.scrollHeight - 600) renderMoreRows();
}

function emptyListHtml() {
    const hasEntries = entries[tab].length > 0;
    const title = hasEntries
        ? (query ? `Nothing matches “${escapeHtml(query)}”` : `No ${scope === "dms" ? "DM" : "server"} entries`)
        : `No ${TAB_LABELS[tab].toLowerCase()} yet`;
    const text = hasEntries
        ? "Try another search or filter."
        : tab === "deleted" ? "Messages show up here the moment someone deletes them."
            : tab === "edited" ? "Edited messages show up here with the text before and after."
                : "Messages that pinged you and were then deleted or edited show up here.";
    return `<div class="vc-bml-empty">${ICONS.empty}<div class="vc-bml-emptyTitle">${title}</div><div class="vc-bml-emptyText">${text}</div></div>`;
}

function rowHtml(row: Row): string {
    if (row.type === "day") return `<div class="vc-bml-day">${escapeHtml(row.label)}</div>`;
    if (row.type === "group") {
        const collapsed = collapsedGroups.has(row.id);
        return `<button class="vc-bml-group ${collapsed ? "vc-bml-collapsed" : ""}" data-group="${escapeHtml(row.id)}" aria-expanded="${!collapsed}">
            ${guildIconHtml(row.iconUrl, row.acronym, "vc-bml-groupIcon")}
            <span class="vc-bml-groupName">${escapeHtml(row.name)}</span>
            <span class="vc-bml-groupCount">${row.count}</span>
            <span class="vc-bml-groupChevron">${ICONS.chevron}</span>
        </button>`;
    }
    return cardHtml(row.entry);
}

function guildIconHtml(iconUrl: string | null, acronym: string, className: string) {
    return iconUrl
        ? `<img class="${className}" src="${escapeHtml(iconUrl)}" alt="" loading="lazy" draggable="false" />`
        : `<span class="${className} vc-bml-acronym">${escapeHtml(acronym)}</span>`;
}

function placeHtml(message: LogMessage, compact: boolean) {
    const guild = getGuildInfo(message.guildId, message.guildName, message.guildIconUrl);
    const channel = getChannelLabel(message.channelId, message.channelName);
    const icon = guild
        ? guildIconHtml(guild.iconUrl, guild.acronym, "vc-bml-placeIcon")
        : `<span class="vc-bml-placeIcon vc-bml-dmIcon">${ICONS.dm}</span>`;
    const name = guild ? escapeHtml(guild.name) : "Direct Messages";
    return `<span class="vc-bml-place ${compact ? "vc-bml-placeCompact" : ""}">${icon}<span class="vc-bml-placeName">${name}</span><span class="vc-bml-placeSep">›</span><span class="vc-bml-placeChannel">${escapeHtml(channel)}</span></span>`;
}

function mediaSummary(message: LogMessage) {
    const counts: Record<string, number> = {};
    for (const m of message.media) counts[m.kind] = (counts[m.kind] ?? 0) + 1;
    const parts: string[] = [];
    const add = (kind: string, icon: string, one: string, many: string) => {
        const n = counts[kind];
        if (n) parts.push(`<span class="vc-bml-chip">${icon}${n > 1 ? `${n} ${many}` : one}</span>`);
    };
    add("image", ICONS.image, "Image", "images");
    add("video", ICONS.video, "Video", "videos");
    add("audio", ICONS.audio, "Audio", "audio files");
    add("file", ICONS.file, "File", "files");
    if (message.forwarded) parts.push(`<span class="vc-bml-chip">${ICONS.forward}Forwarded</span>`);
    if (message.embeds.length && !message.content) parts.push("<span class=\"vc-bml-chip\">Embed</span>");
    return parts.join("");
}

function previewText(message: LogMessage): string {
    const ctx = contextFor(message);
    return plainPreview(message.content, ctx)
        || plainPreview(message.forwarded?.content ?? "", ctx)
        || plainPreview(message.extraText.join(" "), ctx)
        || plainPreview(message.embeds.map(e => e.title || e.description || e.authorName).join(" "), ctx)
        || "";
}

function cardHtml(entry: LogEntry): string {
    const message = entryMessage(entry);
    const active = entry.key === selectedKey;
    let preview: string;

    if (entry.tab === "edited") {
        const before = previewText(entry.before) || "No text";
        const after = previewText(entry.after) || "No text";
        preview = `<span class="vc-bml-previewOld">${escapeHtml(before)}</span><span class="vc-bml-previewArrow">→</span>${escapeHtml(after)}`;
    } else {
        const text = previewText(message);
        preview = text ? escapeHtml(text) : `<span class="vc-bml-muted">${message.media.length ? "" : "No text"}</span>`;
    }

    const badge = entry.tab === "ghostPings"
        ? `<span class="vc-bml-chip vc-bml-chipPing">${ICONS.at}${entry.reason === "deleted" ? "Deleted" : "Edited"}</span>`
        : "";

    return `<div class="vc-bml-card ${active ? "vc-bml-active" : ""}" role="option" aria-selected="${active}" data-key="${escapeHtml(entry.key)}">
        <img class="vc-bml-avatar" src="${escapeHtml(message.author.avatarUrl)}" alt="" loading="lazy" draggable="false" />
        <div class="vc-bml-cardMain">
            <div class="vc-bml-cardTop">
                <span class="vc-bml-author">${escapeHtml(message.author.name)}</span>
                ${message.author.bot ? '<span class="vc-bml-botTag">BOT</span>' : ""}
                <span class="vc-bml-time" title="${escapeHtml(formatDate(entryTime(entry), true))}">${escapeHtml(formatShort(entryTime(entry)))}</span>
            </div>
            ${placeHtml(message, true)}
            <div class="vc-bml-preview">${preview}</div>
            ${badge || message.media.length || message.forwarded ? `<div class="vc-bml-chips">${badge}${mediaSummary(message)}</div>` : ""}
        </div>
    </div>`;
}

function selectEntry(key: string | null, scroll = false) {
    if (!els || key === selectedKey) {
        if (els && key) els.win.classList.add("vc-bml-showDetail");
        return;
    }
    els.list.querySelector(".vc-bml-card.vc-bml-active")?.classList.remove("vc-bml-active");
    selectedKey = key;
    if (key) {
        // render more rows if the card is further down than what's drawn
        let card = els.list.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
        if (!card) {
            renderList(false);
            card = els.list.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
        }
        card?.classList.add("vc-bml-active");
        if (scroll) card?.scrollIntoView({ block: "nearest" });
        els.win.classList.add("vc-bml-showDetail");
    }
    renderDetail();
}

function scrollSelectedIntoView() {
    if (!els || !selectedKey) return;
    els.list.querySelector<HTMLElement>(`[data-key="${CSS.escape(selectedKey)}"]`)?.scrollIntoView({ block: "nearest" });
}

function moveSelection(delta: number) {
    if (!visibleEntries.length) return;
    let index = visibleEntries.findIndex(e => e.key === selectedKey);
    index = index === -1 ? 0 : Math.min(visibleEntries.length - 1, Math.max(0, index + delta));
    const { key } = visibleEntries[index];
    // a collapsed group hides its cards; open it so the selection stays visible
    if (scope === "servers") {
        const groupId = entryMessage(visibleEntries[index]).guildId ?? "unknown";
        if (collapsedGroups.delete(groupId)) {
            selectedKey = key;
            refresh(false);
            scrollSelectedIntoView();
            return;
        }
    }
    selectEntry(key, true);
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function revokeObjectUrls() {
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls = [];
}

function savedCount(entry: LogEntry | null) {
    if (!entry) return 0;
    const lists = entry.tab === "edited" ? [entry.before.media, entry.after.media] : [entry.message.media];
    let n = 0;
    for (const list of lists) for (const m of list) if (m.saved) n++;
    return n;
}

function renderDetail() {
    if (!els) return;
    const entry = selectedKey ? getEntry(selectedKey) ?? null : null;
    const saved = savedCount(entry);
    // skip redraws that would change nothing (keeps playing audio and scroll position)
    if (detailFor.entry === entry && detailFor.saved === saved && els.detail.childElementCount) return;
    detailFor = { entry, saved };

    const token = ++detailToken;
    const { scrollTop } = els.detail;
    const sameEntry = els.detail.dataset.key === (entry?.key ?? "");
    revokeObjectUrls();
    els.detail.dataset.key = entry?.key ?? "";

    if (!entry) {
        els.detail.innerHTML = `<div class="vc-bml-empty">${ICONS.empty}<div class="vc-bml-emptyTitle">Nothing selected</div><div class="vc-bml-emptyText">Pick an entry on the left to see the full message.</div></div>`;
        els.win.classList.remove("vc-bml-showDetail");
        return;
    }

    els.detail.innerHTML = detailHtml(entry);
    els.detail.scrollTop = sameEntry ? scrollTop : 0;
    void hydrateSavedMedia(entry, token);
}

function detailHtml(entry: LogEntry): string {
    const message = entryMessage(entry);
    const kind = entry.tab === "deleted"
        ? `<span class="vc-bml-kind vc-bml-kindDeleted">${entry.kind === "bulk-delete" ? "Bulk deleted" : "Deleted"}</span>`
        : entry.tab === "edited"
            ? '<span class="vc-bml-kind vc-bml-kindEdited">Edited</span>'
            : `<span class="vc-bml-kind vc-bml-kindPing">Ghost ping, ${entry.reason}</span>`;

    const times: Array<[string, string]> = [["Sent", message.timestamp]];
    if (entry.tab === "deleted") times.push(["Deleted", entry.deletedAt]);
    if (entry.tab === "edited") times.push(["Edited", entry.editedAt]);
    if (entry.tab === "ghostPings") times.push([entry.reason === "deleted" ? "Deleted" : "Edited", entry.detectedAt]);

    let body: string;
    if (entry.tab === "edited") {
        const ctxBefore = contextFor(entry.before);
        const ctxAfter = contextFor(entry.after);
        const diff = diffWords(readableText(entry.before.content, ctxBefore), readableText(entry.after.content, ctxAfter));
        const beforeHtml = diff ? diff[0] : escapeHtml(readableText(entry.before.content, ctxBefore));
        const afterHtml = diff ? diff[1] : escapeHtml(readableText(entry.after.content, ctxAfter));
        const removedMedia = entry.before.media.filter(m => !entry.after.media.some(a => a.url === m.url));

        body = `
            <section class="vc-bml-section">
                <h3>Before</h3>
                <div class="vc-bml-bubble vc-bml-diff">${beforeHtml || '<span class="vc-bml-muted">No text</span>'}</div>
                ${removedMedia.length ? `<div class="vc-bml-subhead">Removed by this edit</div>${mediaHtml(removedMedia, "before")}` : ""}
            </section>
            <section class="vc-bml-section">
                <h3>After</h3>
                <div class="vc-bml-bubble vc-bml-diff">${afterHtml || '<span class="vc-bml-muted">No text</span>'}</div>
            </section>
            <section class="vc-bml-section">
                <h3>Current message</h3>
                ${messageBodyHtml(entry.after, "after")}
            </section>
            ${editHistoryHtml(entry)}`;
    } else {
        body = `<section class="vc-bml-section"><h3>Message</h3>${messageBodyHtml(message, "message")}</section>`;
    }

    return `
        <div class="vc-bml-detailTop">
            <button class="vc-bml-iconBtn vc-bml-back" data-action="back" title="Back to the list" aria-label="Back">${ICONS.back}</button>
            <img class="vc-bml-detailAvatar" src="${escapeHtml(message.author.avatarUrl)}" alt="" draggable="false" />
            <div class="vc-bml-detailWho">
                <div class="vc-bml-detailName">${escapeHtml(message.author.name)}${message.author.bot ? '<span class="vc-bml-botTag">BOT</span>' : ""}</div>
                <div class="vc-bml-detailUser">@${escapeHtml(message.author.username)}</div>
            </div>
            ${kind}
        </div>
        <div class="vc-bml-placeRow">${placeHtml(message, false)}</div>
        <div class="vc-bml-times">
            ${times.map(([label, iso]) => `<div class="vc-bml-timeItem"><span>${label}</span><strong title="${escapeHtml(formatDate(iso, true))}">${escapeHtml(formatDate(iso))}</strong></div>`).join("")}
        </div>
        <div class="vc-bml-actions">
            <button class="vc-bml-btn vc-bml-primary" data-action="jump">${ICONS.jump}<span>Jump to message</span></button>
            <button class="vc-bml-btn" data-action="copy">${ICONS.copy}<span>Copy text</span></button>
            <button class="vc-bml-btn vc-bml-danger" data-action="remove">${ICONS.trash}<span>Remove from log</span></button>
        </div>
        ${body}`;
}

function editHistoryHtml(entry: LogEntry & { tab: "edited"; }) {
    const others = entries.edited.filter(e => e.messageId === entry.messageId);
    if (others.length < 2) return "";
    return `<section class="vc-bml-section">
        <h3>All edits of this message · ${others.length}</h3>
        <div class="vc-bml-timeline">
            ${others.map(e => `<button class="vc-bml-timelineItem ${e.key === entry.key ? "vc-bml-active" : ""}" data-key="${escapeHtml(e.key)}">
                <span class="vc-bml-timelineTime">${escapeHtml(formatDate(e.editedAt))}</span>
                <span class="vc-bml-timelineText">${escapeHtml(plainPreview(e.after.content, contextFor(e.after), 90) || "No text")}</span>
            </button>`).join("")}
        </div>
    </section>`;
}

function messageBodyHtml(message: LogMessage, group: string): string {
    const ctx = contextFor(message);
    const parts: string[] = [];

    if (message.replyTo) {
        parts.push(`<div class="vc-bml-reply"><span class="vc-bml-replyName">${escapeHtml(message.replyTo.authorName)}</span>${escapeHtml(plainPreview(message.replyTo.content, ctx, 120))}</div>`);
    }
    if (message.content) parts.push(`<div class="vc-bml-bubble vc-bml-markdown">${renderMarkdown(message.content, ctx)}</div>`);
    for (const text of message.extraText) parts.push(`<div class="vc-bml-bubble vc-bml-markdown">${renderMarkdown(text, ctx)}</div>`);
    if (message.forwarded) {
        parts.push(`<div class="vc-bml-forward"><div class="vc-bml-forwardLabel">${ICONS.forward}Forwarded</div>
            ${message.forwarded.content ? `<div class="vc-bml-markdown">${renderMarkdown(message.forwarded.content, ctx)}</div>` : ""}
            ${message.forwarded.embeds.map(e => embedHtml(e, ctx)).join("")}
        </div>`);
    }
    for (const embed of message.embeds) parts.push(embedHtml(embed, ctx));
    if (message.media.length) parts.push(mediaHtml(message.media, group));

    if (!parts.length) parts.push('<div class="vc-bml-bubble"><span class="vc-bml-muted">This message had no text or media that could be logged.</span></div>');
    return parts.join("");
}

function embedHtml(embed: LogEmbed, ctx: RenderContext): string {
    const color = embed.color && /^#[0-9a-f]{3,8}$/i.test(embed.color) ? embed.color : "";
    const title = embed.title
        ? (safeUrl(embed.url)
            ? `<a class="vc-bml-embedTitle" href="${escapeHtml(safeUrl(embed.url))}" target="_blank" rel="noreferrer noopener">${renderMarkdown(embed.title, ctx)}</a>`
            : `<div class="vc-bml-embedTitle">${renderMarkdown(embed.title, ctx)}</div>`)
        : "";
    const image = discordMediaUrl(embed.image);
    const thumb = discordMediaUrl(embed.thumbnail);

    return `<div class="vc-bml-embed" ${color ? `style="--vc-bml-embed-color:${color}"` : ""}>
        <div class="vc-bml-embedMain">
            ${embed.providerName ? `<div class="vc-bml-embedProvider">${escapeHtml(embed.providerName)}</div>` : ""}
            ${embed.authorName ? `<div class="vc-bml-embedAuthor">${discordMediaUrl(embed.authorIcon) ? `<img src="${escapeHtml(discordMediaUrl(embed.authorIcon))}" alt="" loading="lazy" />` : ""}${escapeHtml(embed.authorName)}</div>` : ""}
            ${title}
            ${embed.description ? `<div class="vc-bml-embedDesc vc-bml-markdown">${renderMarkdown(embed.description, ctx)}</div>` : ""}
            ${embed.fields.length ? `<div class="vc-bml-embedFields">${embed.fields.map(f => `<div class="vc-bml-embedField ${f.inline ? "vc-bml-inline" : ""}"><div class="vc-bml-embedFieldName">${renderMarkdown(f.name, ctx)}</div><div class="vc-bml-markdown">${renderMarkdown(f.value, ctx)}</div></div>`).join("")}</div>` : ""}
            ${image ? `<button class="vc-bml-embedImage" data-action="lightbox" data-src="${escapeHtml(image)}" data-type="image"><img src="${escapeHtml(image)}" alt="" loading="lazy" /></button>` : ""}
            ${embed.footerText ? `<div class="vc-bml-embedFooter">${escapeHtml(embed.footerText)}</div>` : ""}
        </div>
        ${thumb && !image ? `<img class="vc-bml-embedThumb" src="${escapeHtml(thumb)}" alt="" loading="lazy" />` : ""}
    </div>`;
}

function mediaHtml(list: LogMedia[], group: string): string {
    const visual = list.filter(m => m.kind === "image" || m.kind === "video");
    const other = list.filter(m => m.kind === "audio" || m.kind === "file");
    const ref = (m: LogMedia) => `data-group="${group}" data-media="${escapeHtml(m.key)}"`;
    const status = (m: LogMedia) => m.saved
        ? `<span class="vc-bml-saved" title="A copy is saved on this computer">${ICONS.check}Saved</span>`
        : '<span class="vc-bml-online" title="Loaded from Discord. The link can stop working after a while.">Online</span>';

    const visualHtml = visual.map(m => {
        const src = escapeHtml(m.kind === "image" ? discordMediaUrl(m.proxyUrl, m.url) : discordMediaUrl(m.url, m.proxyUrl));
        const ratio = m.width && m.height ? `style="aspect-ratio:${m.width}/${m.height}"` : "";
        const inner = m.kind === "image"
            ? `<button class="vc-bml-mediaOpen" data-action="lightbox" data-type="image" ${ref(m)}><img class="vc-bml-mediaEl" ${ref(m)} src="${src}" alt="${escapeHtml(m.filename)}" loading="lazy" draggable="false" ${ratio} /></button>`
            : m.gifv
                ? `<video class="vc-bml-mediaEl" ${ref(m)} src="${src}" autoplay loop muted playsinline ${ratio}></video>`
                : `<video class="vc-bml-mediaEl" ${ref(m)} src="${src}" controls preload="metadata" playsinline ${ratio}></video>`;
        return `<figure class="vc-bml-mediaItem ${m.spoiler ? "vc-bml-spoilerMedia" : ""}">
            ${inner}
            ${m.spoiler ? '<button class="vc-bml-spoilerCover" data-action="reveal">Spoiler</button>' : ""}
            <figcaption><span class="vc-bml-mediaName" title="${escapeHtml(m.filename)}">${escapeHtml(m.filename)}</span>${status(m)}<button class="vc-bml-miniBtn" data-action="download" ${ref(m)} title="Download">${ICONS.download}</button></figcaption>
        </figure>`;
    }).join("");

    const otherHtml = other.map(m => {
        const icon = m.kind === "audio" ? ICONS.audio : ICONS.file;
        const player = m.kind === "audio"
            ? `<audio class="vc-bml-mediaEl vc-bml-audio" ${ref(m)} src="${escapeHtml(discordMediaUrl(m.url, m.proxyUrl))}" controls preload="metadata"></audio>`
            : "";
        return `<div class="vc-bml-fileItem">
            <div class="vc-bml-fileRow">
                <span class="vc-bml-fileIcon">${icon}</span>
                <div class="vc-bml-fileInfo"><div class="vc-bml-mediaName" title="${escapeHtml(m.filename)}">${escapeHtml(m.filename)}</div><div class="vc-bml-fileMeta">${escapeHtml(formatBytes(m.size))} ${status(m)}</div></div>
                <button class="vc-bml-miniBtn" data-action="download" ${ref(m)} title="Download">${ICONS.download}</button>
            </div>
            ${player}
        </div>`;
    }).join("");

    return `${visualHtml ? `<div class="vc-bml-gallery ${visual.length === 1 ? "vc-bml-single" : ""}">${visualHtml}</div>` : ""}${otherHtml ? `<div class="vc-bml-files">${otherHtml}</div>` : ""}`;
}

function mediaGroups(entry: LogEntry): Record<string, LogMessage> {
    return entry.tab === "edited" ? { before: entry.before, after: entry.after } : { message: entry.message };
}

function findMedia(entry: LogEntry, group: string | undefined, key: string | undefined): { message: LogMessage; media: LogMedia; } | null {
    if (!group || !key) return null;
    const message = mediaGroups(entry)[group];
    const media = message?.media.find(m => m.key === key);
    return message && media ? { message, media } : null;
}

/** Swaps Discord links for the saved local copies. */
async function hydrateSavedMedia(entry: LogEntry, token: number) {
    for (const [group, message] of Object.entries(mediaGroups(entry))) {
        for (const media of message.media) {
            if (!media.saved) continue;
            const blob = await getSavedMediaBlob(message.id, media);
            if (token !== detailToken || !els) return;
            if (!blob) continue;
            const url = URL.createObjectURL(blob);
            objectUrls.push(url);
            els.detail.querySelectorAll<HTMLImageElement | HTMLMediaElement>(`.vc-bml-mediaEl[data-group="${group}"][data-media="${CSS.escape(media.key)}"]`).forEach(el => {
                el.classList.remove("vc-bml-broken");
                el.closest(".vc-bml-mediaItem, .vc-bml-fileItem")?.querySelector(".vc-bml-gone")?.remove();
                el.src = url;
            });
        }
    }
}

function onMediaError(e: Event) {
    const el = e.target as HTMLElement;
    if (!(el instanceof HTMLImageElement || el instanceof HTMLMediaElement)) return;
    if (!el.classList.contains("vc-bml-mediaEl")) {
        if (el instanceof HTMLImageElement) el.style.display = "none";
        return;
    }
    // a saved copy may still be on the way, so only mark it
    el.classList.add("vc-bml-broken");
    const item = el.closest(".vc-bml-mediaItem, .vc-bml-fileItem");
    if (item && !item.querySelector(".vc-bml-gone")) {
        item.insertAdjacentHTML("afterbegin", '<div class="vc-bml-gone">No longer available on Discord</div>');
    }
}

// ---------------------------------------------------------------------------
// Lightbox
// ---------------------------------------------------------------------------

function openLightbox(src: string, type: "image" | "video") {
    if (!els || !src) return;
    const safe = escapeHtml(src);
    els.lightbox.innerHTML = `<div class="vc-bml-lightboxInner">
        ${type === "video" ? `<video src="${safe}" controls autoplay playsinline></video>` : `<img src="${safe}" alt="" draggable="false" />`}
        <button class="vc-bml-iconBtn vc-bml-lightboxClose" data-action="close-lightbox" aria-label="Close preview">${ICONS.close}</button>
    </div>`;
    els.lightbox.hidden = false;
    requestAnimationFrame(() => els?.lightbox.classList.add("vc-bml-lightboxOpen"));
}

function closeLightbox(): boolean {
    if (!els || els.lightbox.hidden) return false;
    els.lightbox.classList.remove("vc-bml-lightboxOpen");
    els.lightbox.hidden = true;
    els.lightbox.innerHTML = "";
    return true;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function onSearchInput() {
    if (!els) return;
    els.root.classList.toggle("vc-bml-hasQuery", !!els.search.value);
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        if (!els) return;
        query = els.search.value.trim();
        selectedKey = null;
        computeVisible();
        renderList(true);
        renderDetail();
    }, SEARCH_DELAY);
}

function onKeyDown(e: KeyboardEvent) {
    // Discord listens for keys on the whole page; keep ours to ourselves
    e.stopPropagation();
    if (!els) return;

    const typing = e.target === els.search;
    if (e.key === "Escape") {
        e.preventDefault();
        if (closeLightbox()) return;
        if (typing && els.search.value) {
            els.search.value = "";
            onSearchInput();
            return;
        }
        if (els.win.classList.contains("vc-bml-showDetail") && matchMedia("(max-width: 860px)").matches) {
            els.win.classList.remove("vc-bml-showDetail");
            return;
        }
        closeOverlay();
        return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const target = e.target as HTMLElement;
        if (target instanceof HTMLMediaElement) return;
        e.preventDefault();
        moveSelection(e.key === "ArrowDown" ? 1 : -1);
        return;
    }
    if ((e.key === "f" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        els.search.focus();
        els.search.select();
    }
}

function onClick(e: MouseEvent) {
    if (!els) return;
    const target = e.target as HTMLElement;

    const spoiler = target.closest<HTMLElement>(".vc-bml-spoiler");
    if (spoiler) {
        spoiler.classList.add("vc-bml-revealed");
        return;
    }

    const actionEl = target.closest<HTMLElement>("[data-action]");
    const action = actionEl?.dataset.action;

    if (action === "close") return closeOverlay();
    if (action === "close-lightbox" || (target === els.lightbox || target.classList.contains("vc-bml-lightboxInner"))) {
        closeLightbox();
        return;
    }

    const tabBtn = target.closest<HTMLElement>("[data-tab]");
    if (tabBtn) {
        const next = tabBtn.dataset.tab as Tab;
        if (next !== tab) {
            tab = next;
            selectedKey = null;
            els.win.classList.remove("vc-bml-showDetail");
            refresh(true);
        }
        return;
    }

    const scopeBtn = target.closest<HTMLElement>("[data-scope]");
    if (scopeBtn) {
        const next = scopeBtn.dataset.scope as Scope;
        if (next !== scope) {
            scope = next;
            selectedKey = null;
            refresh(true);
        }
        return;
    }

    const groupBtn = target.closest<HTMLElement>("button[data-group]:not([data-media])");
    if (groupBtn && !action) {
        const id = groupBtn.dataset.group!;
        if (!collapsedGroups.delete(id)) collapsedGroups.add(id);
        computeVisible();
        renderList(false);
        return;
    }

    const card = target.closest<HTMLElement>(".vc-bml-card, .vc-bml-timelineItem");
    if (card?.dataset.key && !action) {
        selectEntry(card.dataset.key, card.classList.contains("vc-bml-timelineItem"));
        return;
    }

    if (!action) return;
    e.preventDefault();
    const entry = selectedKey ? getEntry(selectedKey) : undefined;

    switch (action) {
        case "export":
            exportLogs();
            break;
        case "clear":
            onClearTab(actionEl!);
            break;
        case "clear-search":
            els.search.value = "";
            onSearchInput();
            els.search.focus();
            break;
        case "back":
            els.win.classList.remove("vc-bml-showDetail");
            break;
        case "jump":
            if (entry) jumpTo(entryMessage(entry));
            break;
        case "copy":
            if (entry) copyEntry(entry);
            break;
        case "remove":
            if (entry) removeEntry(entry);
            break;
        case "reveal":
            actionEl!.closest(".vc-bml-spoilerMedia")?.classList.remove("vc-bml-spoilerMedia");
            actionEl!.remove();
            break;
        case "lightbox": {
            const direct = actionEl!.dataset.src;
            if (direct) {
                openLightbox(direct, "image");
                break;
            }
            const img = actionEl!.querySelector<HTMLImageElement>("img");
            if (img && !img.classList.contains("vc-bml-broken")) openLightbox(img.currentSrc || img.src, "image");
            break;
        }
        case "download":
            if (entry) void downloadMedia(entry, actionEl!.dataset.group, actionEl!.dataset.media);
            break;
        case "profile":
            openBrandProfile();
            break;
    }
}

function exportLogs() {
    const name = `BestMessageLogger-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const data = new TextEncoder().encode(exportJson());
    try {
        const native = (window as any).DiscordNative;
        if (native?.fileManager?.saveWithDialog) native.fileManager.saveWithDialog(data, name);
        else saveFile(new File([data], name, { type: "application/json" }));
    } catch (e) {
        logger.error("Export failed", e);
        showToast({ text: "Export failed. See the console for details.", variant: "critical" });
    }
}

function onClearTab(button: HTMLElement) {
    const label = button.querySelector(".vc-bml-clearLabel");
    if (Date.now() > clearArmedUntil) {
        clearArmedUntil = Date.now() + 3000;
        button.classList.add("vc-bml-armed");
        if (label) label.textContent = "Click again to clear";
        setTimeout(() => {
            if (Date.now() < clearArmedUntil) return;
            button.classList.remove("vc-bml-armed");
            if (label) label.textContent = "Clear tab";
        }, 3050);
        return;
    }
    clearArmedUntil = 0;
    button.classList.remove("vc-bml-armed");
    if (label) label.textContent = "Clear tab";
    if (tab === "deleted") hideFromChat(entries.deleted.map(e => e.message));
    const count = entries[tab].length;
    clearTab(tab);
    selectedKey = null;
    showToast({ text: `Removed ${count} ${count === 1 ? "entry" : "entries"}.`, variant: "success" });
}

function hideFromChat(messages: LogMessage[]) {
    for (const m of messages) {
        const record = MessageStore.getMessage(m.channelId, m.id) as any;
        if (record?.deleted) FluxDispatcher.dispatch({ type: "MESSAGE_DELETE", channelId: m.channelId, id: m.id, mlDeleted: true });
    }
}

function removeEntry(entry: LogEntry) {
    const index = visibleEntries.findIndex(e => e.key === entry.key);
    const next = visibleEntries[index + 1] ?? visibleEntries[index - 1] ?? null;
    removeEntries([entry.key]);
    if (entry.tab === "deleted") hideFromChat([entry.message]);
    selectedKey = next?.key ?? null;
    refresh(false);
}

function jumpTo(message: LogMessage) {
    closeOverlay();
    try {
        NavigationRouter.transitionTo(messageLink(message));
    } catch (e) {
        logger.error("Jump failed", e);
        showToast({ text: "Could not open that message.", variant: "critical" });
    }
}

function copyEntry(entry: LogEntry) {
    const message = entryMessage(entry);
    const text = entry.tab === "edited"
        ? `Before:\n${entry.before.content}\n\nAfter:\n${entry.after.content}`
        : [message.content, ...message.extraText, message.forwarded?.content ?? ""].filter(Boolean).join("\n\n") || message.media.map(m => m.url).join("\n");
    copyToClipboard(text).then(
        () => showToast({ text: "Copied to clipboard.", variant: "success" }),
        () => showToast({ text: "Could not copy.", variant: "critical" })
    );
}

async function downloadMedia(entry: LogEntry, group?: string, key?: string) {
    const found = findMedia(entry, group, key);
    if (!found) return;
    const { message, media } = found;
    const blob = await getSavedMediaBlob(message.id, media);
    try {
        if (blob) {
            const native = (window as any).DiscordNative;
            if (native?.fileManager?.saveWithDialog) native.fileManager.saveWithDialog(new Uint8Array(await blob.arrayBuffer()), media.filename);
            else saveFile(new File([blob], media.filename, { type: blob.type || media.contentType }));
            return;
        }
        const a = document.createElement("a");
        a.href = media.url;
        a.target = "_blank";
        a.rel = "noreferrer noopener";
        a.click();
    } catch (e) {
        logger.error("Download failed", e);
        showToast({ text: "Download failed.", variant: "critical" });
    }
}

// ---------------------------------------------------------------------------
// Hotkey
// ---------------------------------------------------------------------------

let hotkeyHandler: ((e: KeyboardEvent) => void) | null = null;

function parseHotkey(hotkey: string) {
    const parts = hotkey.toLowerCase().split("+").map(x => x.trim()).filter(Boolean);
    const modifiers = ["ctrl", "control", "shift", "alt", "option", "meta", "cmd", "command", "super", "win"];
    return {
        ctrl: parts.includes("ctrl") || parts.includes("control"),
        shift: parts.includes("shift"),
        alt: parts.includes("alt") || parts.includes("option"),
        meta: ["meta", "cmd", "command", "super", "win"].some(m => parts.includes(m)),
        key: parts.find(x => !modifiers.includes(x)) ?? "i"
    };
}

export function setupHotkey() {
    teardownHotkey();
    hotkeyHandler = e => {
        if (e.repeat) return;
        const hk = parseHotkey(settings.store.openHotkey || "Ctrl+Shift+I");
        if (e.ctrlKey !== hk.ctrl || e.shiftKey !== hk.shift || e.altKey !== hk.alt || e.metaKey !== hk.meta) return;
        const key = e.key.toLowerCase();
        const code = e.code.toLowerCase();
        if (key !== hk.key && code !== `key${hk.key}` && code !== `digit${hk.key}`) return;
        e.preventDefault();
        e.stopPropagation();
        toggleOverlay();
    };
    window.addEventListener("keydown", hotkeyHandler, true);
}

export function teardownHotkey() {
    if (hotkeyHandler) window.removeEventListener("keydown", hotkeyHandler, true);
    hotkeyHandler = null;
}

/** Keeps the open menu in sync after a store change made elsewhere (e.g. clearing from chat). */
export function refreshOverlayIfStale() {
    if (isOpen && renderedVersion !== getVersion()) scheduleRefresh();
}
