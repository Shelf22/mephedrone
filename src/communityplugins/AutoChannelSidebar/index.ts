/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Jumble
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { FluxStore } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import {
    GuildChannelStore,
    PermissionsBits,
    PermissionStore,
    SelectedGuildStore,
} from "@webpack/common";

const author = { name: "Jumble", id: 1135976262234542233n };
const MIN_WIDTH = 264;
const MAX_WIDTH = 600;
const EXTRA_SPACE = 102;
const SIDEBAR_STYLE_PROPERTIES = ["width", "min-width", "max-width", "flex-basis", "flex-shrink"];
const SIDEBAR_PANEL_CLASS = /^sidebar(?:_[\w-]+)?$/;

const CategoryCollapseStore = findStoreLazy("CategoryCollapseStore") as FluxStore & {
    getCollapsedCategories(): Record<string, boolean>;
};

let observer: MutationObserver | undefined;
let frameId: number | undefined;
let ownedSidebar: HTMLElement | undefined;
let originalStyles: Map<string, { value: string; priority: string }> | undefined;
let ownedChannelList: HTMLElement | undefined;
let originalChannelListStyles: Map<string, { value: string; priority: string }> | undefined;
let ownedBannerImage: HTMLElement | undefined;
let originalBannerImageWidth: { value: string; priority: string } | undefined;
let ownedBannerContent: HTMLImageElement | undefined;
let originalBannerContentWidth: { value: string; priority: string } | undefined;
let ownedGrid: HTMLElement | undefined;
let originalGridTemplateColumns: { value: string; priority: string } | undefined;
let baseGridTemplateColumns: string | undefined;
let ownedResizeHandle: HTMLElement | undefined;
let originalResizeHandlePointerEvents: { value: string; priority: string } | undefined;
let measureCanvas: HTMLCanvasElement | undefined;

const settings = definePluginSettings({
    minimumWidth: {
        description: "Minimum overall sidebar width in pixels",
        displayName: "Minimum Sidebar Width",
        type: OptionType.SLIDER,
        markers: makeRange(MIN_WIDTH, MAX_WIDTH, 24),
        default: MIN_WIDTH,
        stickToMarkers: false,
        onChange: schedule,
    },
});

function findSidebar(handle?: HTMLElement): HTMLElement | undefined {
    const list = document.querySelector<HTMLElement>(
        '[class*="sidebarList"], [class*="channelList"]',
    );

    if (handle) {
        let node: HTMLElement | null = handle;
        for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
            if (
                node !== list &&
                Array.from(node.classList).some(className =>
                    SIDEBAR_PANEL_CLASS.test(className),
                ) &&
                (!list || node.contains(list))
            ) {
                return node;
            }
        }
    }

    let node = list?.parentElement ?? null;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
        if (Array.from(node.classList).some(className => SIDEBAR_PANEL_CLASS.test(className))) {
            return node;
        }
    }
}

function findSidebarGrid(sidebar: HTMLElement): HTMLElement | undefined {
    let node = sidebar.parentElement;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
        const columns = getComputedStyle(node).gridTemplateColumns;
        if (columns.includes("[guildsEnd]") && columns.includes("[channelsEnd]")) return node;
    }
}

function resizeGridTemplate(
    columns: string,
    desiredChannelWidth: number,
    minimumSidebarWidth: number,
): { columns: string; channelWidth: number; sidebarWidth: number } | undefined {
    const guildsEnd = columns.indexOf("[guildsEnd]");
    const channelsEnd = columns.indexOf("[channelsEnd]", guildsEnd + 1);
    if (guildsEnd < 0 || channelsEnd < 0) return;

    const guildWidth = columns.slice(0, guildsEnd).match(/([\d.]+)px\s*$/);
    const remainingTrack = columns
        .slice(channelsEnd + "[channelsEnd]".length)
        .match(/^\s*[\d.]+px(.*)$/);
    if (!guildWidth || !remainingTrack) return;

    const guildRailWidth = Number(guildWidth[1]);
    const sidebarWidth = Math.round(
        Math.max(minimumSidebarWidth, Math.min(MAX_WIDTH, guildRailWidth + desiredChannelWidth)),
    );
    const channelWidth = Math.max(0, sidebarWidth - guildRailWidth);
    const beforeGuildsEnd = columns.slice(0, guildsEnd).trimEnd();
    const trailingLines = remainingTrack[1].trim();

    return {
        columns: `${beforeGuildsEnd} [guildsEnd] ${channelWidth}px [channelsEnd] minmax(0, 1fr)${trailingLines ? ` ${trailingLines}` : ""}`,
        channelWidth,
        sidebarWidth,
    };
}

function rememberSidebar(sidebar: HTMLElement) {
    if (sidebar === ownedSidebar) return;

    restoreSidebar();
    ownedSidebar = sidebar;
    originalStyles = new Map(
        SIDEBAR_STYLE_PROPERTIES.map(property => [
            property,
            {
                value: sidebar.style.getPropertyValue(property),
                priority: sidebar.style.getPropertyPriority(property),
            },
        ]),
    );
}

function rememberGrid(grid: HTMLElement) {
    if (grid === ownedGrid) return;

    restoreGrid();
    ownedGrid = grid;
    originalGridTemplateColumns = {
        value: grid.style.getPropertyValue("grid-template-columns"),
        priority: grid.style.getPropertyPriority("grid-template-columns"),
    };
    baseGridTemplateColumns = getComputedStyle(grid).gridTemplateColumns;
}

function rememberChannelList(channelList: HTMLElement) {
    if (channelList === ownedChannelList) return;

    restoreChannelList();
    ownedChannelList = channelList;
    originalChannelListStyles = new Map(
        ["width", "min-width", "max-width"].map(property => [
            property,
            {
                value: channelList.style.getPropertyValue(property),
                priority: channelList.style.getPropertyPriority(property),
            },
        ]),
    );
}

function rememberBannerElements(
    bannerImage: HTMLElement | undefined,
    bannerContent: HTMLImageElement | undefined,
) {
    if (bannerImage === ownedBannerImage && bannerContent === ownedBannerContent) return;

    restoreBannerImage();
    if (bannerImage) {
        ownedBannerImage = bannerImage;
        originalBannerImageWidth = {
            value: bannerImage.style.getPropertyValue("width"),
            priority: bannerImage.style.getPropertyPriority("width"),
        };
    }
    if (bannerContent) {
        ownedBannerContent = bannerContent;
        originalBannerContentWidth = {
            value: bannerContent.style.getPropertyValue("width"),
            priority: bannerContent.style.getPropertyPriority("width"),
        };
    }
}

function restoreBannerImage() {
    if (ownedBannerImage && originalBannerImageWidth) {
        const { value, priority } = originalBannerImageWidth;
        if (value) ownedBannerImage.style.setProperty("width", value, priority);
        else ownedBannerImage.style.removeProperty("width");
    }
    if (ownedBannerContent && originalBannerContentWidth) {
        const { value, priority } = originalBannerContentWidth;
        if (value) ownedBannerContent.style.setProperty("width", value, priority);
        else ownedBannerContent.style.removeProperty("width");
    }

    ownedBannerImage = undefined;
    originalBannerImageWidth = undefined;
    ownedBannerContent = undefined;
    originalBannerContentWidth = undefined;
}

function rememberResizeHandle(handle: HTMLElement | undefined) {
    if (handle === ownedResizeHandle) return;

    restoreResizeHandle();
    if (!handle) return;

    ownedResizeHandle = handle;
    originalResizeHandlePointerEvents = {
        value: handle.style.getPropertyValue("pointer-events"),
        priority: handle.style.getPropertyPriority("pointer-events"),
    };
}

function restoreResizeHandle() {
    if (!ownedResizeHandle || !originalResizeHandlePointerEvents) return;

    const { value, priority } = originalResizeHandlePointerEvents;
    if (value) ownedResizeHandle.style.setProperty("pointer-events", value, priority);
    else ownedResizeHandle.style.removeProperty("pointer-events");

    ownedResizeHandle = undefined;
    originalResizeHandlePointerEvents = undefined;
}

function restoreChannelList() {
    if (!ownedChannelList || !originalChannelListStyles) return;

    for (const [property, { value, priority }] of originalChannelListStyles) {
        if (value) ownedChannelList.style.setProperty(property, value, priority);
        else ownedChannelList.style.removeProperty(property);
    }

    ownedChannelList = undefined;
    originalChannelListStyles = undefined;
}

function restoreGrid() {
    if (!ownedGrid || !originalGridTemplateColumns) return;

    const { value, priority } = originalGridTemplateColumns;
    if (value) ownedGrid.style.setProperty("grid-template-columns", value, priority);
    else ownedGrid.style.removeProperty("grid-template-columns");

    ownedGrid = undefined;
    originalGridTemplateColumns = undefined;
    baseGridTemplateColumns = undefined;
}

function restoreSidebar() {
    if (ownedSidebar && originalStyles) {
        for (const [property, { value, priority }] of originalStyles) {
            if (value) ownedSidebar.style.setProperty(property, value, priority);
            else ownedSidebar.style.removeProperty(property);
        }
    }

    ownedSidebar = undefined;
    originalStyles = undefined;
    restoreChannelList();
    restoreBannerImage();
    restoreGrid();
    restoreResizeHandle();
}

function getChannelNames(guildId: string): string[] {
    const channels = GuildChannelStore.getChannels(guildId);
    const collapsedCategories = CategoryCollapseStore.getCollapsedCategories();

    return Object.values(channels).flatMap(value =>
        Array.isArray(value)
            ? value
                  .filter(
                      ({ channel }) =>
                          PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel) &&
                          !collapsedCategories[channel.parent_id],
                  )
                  .map(({ channel }) => channel.name)
                  .filter((name): name is string => typeof name === "string")
            : [],
    );
}

function update() {
    const guildId = SelectedGuildStore.getGuildId();
    if (!guildId) {
        restoreSidebar();
        return;
    }

    const resizeHandle = document.querySelector<HTMLElement>(
        '[role="separator"][aria-label="Resize Sidebar"]',
    );
    rememberResizeHandle(resizeHandle ?? undefined);
    resizeHandle?.style.setProperty("pointer-events", "none", "important");

    const sidebar = findSidebar(resizeHandle ?? undefined);
    if (!sidebar) {
        if (ownedSidebar && !ownedSidebar.isConnected) restoreSidebar();
        return;
    }

    rememberSidebar(sidebar);
    const channelList = sidebar.querySelector<HTMLElement>('[class*="sidebarList"]');
    if (!channelList) return;

    const bannerImage = sidebar.querySelector<HTMLElement>(
        '[data-has-banner="true"] [class*="bannerImage"]',
    );
    const bannerContent = bannerImage?.querySelector<HTMLImageElement>("img") ?? undefined;
    rememberBannerElements(bannerImage ?? undefined, bannerContent);

    const grid = findSidebarGrid(sidebar);
    if (!grid) return;
    rememberGrid(grid);
    rememberChannelList(channelList);

    measureCanvas ??= document.createElement("canvas");

    const context = measureCanvas.getContext("2d");
    if (!context) return;

    const label = sidebar.querySelector<HTMLElement>('[class*="name"]');
    context.font = (label && getComputedStyle(label).font) || "500 16px sans-serif";

    const longest = Math.max(
        0,
        ...getChannelNames(guildId).map(name => context.measureText(name).width),
    );
    const configuredMinimum = settings.store.minimumWidth;
    const minimumWidth = Number.isFinite(configuredMinimum)
        ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, configuredMinimum))
        : MIN_WIDTH;
    const resizedGrid = resizeGridTemplate(
        baseGridTemplateColumns ?? getComputedStyle(grid).gridTemplateColumns,
        Math.ceil(longest + EXTRA_SPACE),
        minimumWidth,
    );
    if (!resizedGrid) return;

    for (const property of ["width", "min-width", "max-width", "flex-basis"]) {
        sidebar.style.setProperty(property, `${resizedGrid.sidebarWidth}px`, "important");
    }
    sidebar.style.setProperty("flex-shrink", "0", "important");
    for (const property of ["width", "min-width", "max-width"]) {
        channelList.style.setProperty(property, `${resizedGrid.channelWidth}px`, "important");
    }
    if (bannerImage) bannerImage.style.setProperty("width", "100%", "important");
    if (bannerContent) bannerContent.style.setProperty("width", "100%", "important");
    grid.style.setProperty("grid-template-columns", resizedGrid.columns, "important");
}

function schedule() {
    if (frameId !== undefined) return;
    frameId = requestAnimationFrame(() => {
        frameId = undefined;
        update();
    });
}

export default definePlugin({
    name: "AutoChannelSidebar",
    description:
        "Automatically sizes the channel sidebar to fit the longest channel name in the selected server.",
    authors: [author],
    settings,

    start() {
        SelectedGuildStore.addChangeListener(schedule);
        GuildChannelStore.addChangeListener(schedule);
        CategoryCollapseStore.addChangeListener(schedule);
        observer = new MutationObserver(mutations => {
            if (
                mutations.some(
                    mutation =>
                        mutation.type === "childList" ||
                        (mutation.target instanceof Element &&
                            mutation.target.closest('[class*="sidebarList"], [class*="channelList"]')),
                )
            ) {
                schedule();
            }
        });
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ["aria-expanded", "class"],
            childList: true,
            subtree: true,
        });
        schedule();
    },

    stop() {
        observer?.disconnect();
        observer = undefined;
        SelectedGuildStore.removeChangeListener(schedule);
        GuildChannelStore.removeChangeListener(schedule);
        CategoryCollapseStore.removeChangeListener(schedule);
        if (frameId !== undefined) cancelAnimationFrame(frameId);
        frameId = undefined;
        restoreSidebar();
        measureCanvas = undefined;
    },
});
