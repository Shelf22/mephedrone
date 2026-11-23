/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import type { MessageDecorationFactory } from "@api/MessageDecorations";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { AuthenticationStore, MessageStore, MessageTypeSets, ReactDOM, SelectedChannelStore, ThemeStore, Tooltip, useCallback, useLayoutEffect, useMemo, useRef, useState, useStateFromStores } from "@webpack/common";
import type { CSSProperties } from "react";

import { cancelActiveJump, jumpToMessage } from "./jumpToMessage";
import { ConversationTurn, getTurnTargetMessage, MessageSource, NavigationMode, normalizeBotUserId, selectRecentConversationTurns, selectRecentTextMessages, TurnJumpTarget } from "./messageUtils";

const NAVIGATOR_INSET = 24;

type NavigatorPalette = {
    normal: string;
    active: string;
    hover: string;
    focus: string;
};

type NavigatorPortalStyle = CSSProperties & Record<
    "--vc-cn-normal" | "--vc-cn-active" | "--vc-cn-hover" | "--vc-cn-focus",
    string
>;

type NavigationItem = {
    message: Message;
    label: string;
};

function getConcreteColor(value: string) {
    const trimmed = value.trim();
    return trimmed && !trimmed.includes("var(") ? trimmed : null;
}

function getScrollerPalette(scroller: HTMLElement): NavigatorPalette | null {
    const scrollerStyle = window.getComputedStyle(scroller);
    const scrollerColor = getConcreteColor(scrollerStyle.color);
    if (!scrollerColor) return null;

    const getCustomColor = (name: string) => getConcreteColor(scrollerStyle.getPropertyValue(name));
    const normal = getCustomColor("--interactive-normal")
        ?? getCustomColor("--text-muted")
        ?? scrollerColor;
    const active = getCustomColor("--interactive-active")
        ?? getCustomColor("--text-normal")
        ?? normal;
    const hover = getCustomColor("--interactive-hover")
        ?? getCustomColor("--text-normal")
        ?? active;
    const focus = getCustomColor("--focus-primary")
        ?? active;

    return { normal, active, hover, focus };
}

const settings = definePluginSettings({
    displayCount: {
        type: OptionType.SLIDER,
        displayName: "顯示數量",
        description: "顯示最近符合條件的導覽項目數量。",
        markers: makeRange(1, 5),
        default: 3,
        stickToMarkers: true
    },
    smoothScroll: {
        type: OptionType.BOOLEAN,
        displayName: "平滑捲動",
        description: "跳轉時使用平滑捲動，最終仍會精確對齊。",
        default: true
    },
    showTooltip: {
        type: OptionType.BOOLEAN,
        displayName: "顯示提示文字",
        description: "滑過導覽橫條時顯示提示文字。",
        default: true
    },
    messageSource: {
        type: OptionType.SELECT,
        displayName: "訊息來源",
        description: "選擇逐則訊息模式要顯示哪些文字訊息。",
        options: [
            { label: "真人訊息", value: MessageSource.HumanMessages, default: true },
            { label: "我的訊息", value: MessageSource.MyMessages },
            { label: "真人與 Bot", value: MessageSource.HumansAndBots },
            { label: "僅指定 Bot", value: MessageSource.SpecificBotOnly },
            { label: "我的訊息與指定 Bot", value: MessageSource.MyMessagesAndSpecificBot },
        ]
    },
    botUserId: {
        type: OptionType.STRING,
        displayName: "Bot 使用者 ID",
        description: "指定 Bot 模式與對話回合模式使用的 Discord 使用者 ID（17 至 20 位 snowflake）。",
        placeholder: "123456789012345678",
        default: ""
    },
    verticalOffset: {
        type: OptionType.SLIDER,
        displayName: "垂直偏移",
        description: "從聊天區中央上下微調導覽列位置。",
        markers: makeRange(-80, 80, 4),
        default: 0,
        stickToMarkers: false
    },
    navigationMode: {
        type: OptionType.SELECT,
        displayName: "導覽模式",
        description: "選擇逐則訊息或對話回合。對話回合固定使用我的訊息與設定的 Bot 使用者 ID。",
        options: [
            { label: "逐則訊息", value: NavigationMode.IndividualMessages },
            { label: "對話回合", value: NavigationMode.ConversationTurns, default: true }
        ]
    },
    turnJumpTarget: {
        type: OptionType.SELECT,
        displayName: "回合跳轉位置",
        description: "選擇回合橫條的跳轉位置。等待 Agent 回覆的回合會跳到我的提問。",
        options: [
            { label: "我的提問", value: TurnJumpTarget.UserPrompt },
            { label: "Agent 第一段回覆", value: TurnJumpTarget.FirstAgentMessage },
            { label: "Agent 最後一段回覆", value: TurnJumpTarget.LastAgentMessage, default: true }
        ]
    }
}, {
    turnJumpTarget: {
        disabled() {
            return this.store.navigationMode !== NavigationMode.ConversationTurns;
        }
    }
});

function findScrollableAncestor(element: HTMLElement) {
    for (let current: HTMLElement | null = element; current; current = current.parentElement) {
        const { overflowY } = getComputedStyle(current);
        if (current.scrollHeight > current.clientHeight && /auto|scroll|overlay/.test(overflowY)) {
            return current;
        }
    }

    return null;
}

function getTurnJumpTargetLabel(target: TurnJumpTarget) {
    switch (target) {
        case TurnJumpTarget.UserPrompt:
            return "我的提問";
        case TurnJumpTarget.FirstAgentMessage:
            return "Agent 第一段回覆";
        case TurnJumpTarget.LastAgentMessage:
            return "Agent 最後一段回覆";
    }
}

function getConversationTurnLabel(turn: ConversationTurn, index: number, count: number, target: TurnJumpTarget) {
    const title = index === count - 1 ? "最新對話回合" : `對話回合 ${index + 1}`;
    const status = turn.isPending
        ? "等待 Agent 回覆"
        : `Agent 共 ${turn.responseMessages.length} 段回覆`;

    return `${title} · ${status} · 跳到${getTurnJumpTargetLabel(target)}`;
}

function NavigatorButton({ channelId, message, index, count, label, showTooltip, smoothScroll }: {
    channelId: string;
    message: Message;
    index: number;
    count: number;
    label: string;
    showTooltip: boolean;
    smoothScroll: boolean;
}) {
    const button = (
        <button
            className={`vc-conversation-navigator-bar ${index === count - 1 ? "vc-conversation-navigator-bar-newest" : ""}`}
            type="button"
            aria-label={label}
            onClick={() => void jumpToMessage(channelId, message.id, smoothScroll)}
        />
    );

    return showTooltip ? <Tooltip text={label} position="left">{tooltipProps => (
        <button
            className={`vc-conversation-navigator-bar ${index === count - 1 ? "vc-conversation-navigator-bar-newest" : ""}`}
            type="button"
            aria-label={label}
            {...tooltipProps}
            onClick={() => void jumpToMessage(channelId, message.id, smoothScroll)}
        />
    )}</Tooltip> : button;
}

function ConversationNavigator({ hostElement }: { hostElement: HTMLElement; }) {
    const { displayCount, smoothScroll, showTooltip, messageSource, botUserId, verticalOffset, navigationMode, turnJumpTarget } = settings.use([
        "displayCount",
        "smoothScroll",
        "showTooltip",
        "messageSource",
        "botUserId",
        "verticalOffset",
        "navigationMode",
        "turnJumpTarget"
    ]);
    const { channelId, messages } = useStateFromStores([SelectedChannelStore, MessageStore], () => {
        const selectedChannelId = SelectedChannelStore.getChannelId();
        return {
            channelId: selectedChannelId,
            messages: selectedChannelId ? [...(MessageStore.getMessages(selectedChannelId)?._array ?? [])] : []
        };
    });
    const theme = useStateFromStores([ThemeStore], () => ThemeStore.theme);
    const currentUserId = AuthenticationStore.getId();
    const normalizedBotUserId = normalizeBotUserId(botUserId);
    const navigationItems = useMemo(() => {
        if (navigationMode === NavigationMode.ConversationTurns) {
            const turns = selectRecentConversationTurns(
                messages,
                channelId,
                displayCount,
                type => MessageTypeSets.USER_MESSAGE.has(type),
                currentUserId,
                normalizedBotUserId
            );

            return turns.map((turn, index) => ({
                message: getTurnTargetMessage(turn, turnJumpTarget),
                label: getConversationTurnLabel(turn, index, turns.length, turnJumpTarget)
            }));
        }

        const selectedMessages = selectRecentTextMessages(
            messages,
            channelId,
            displayCount,
            type => MessageTypeSets.USER_MESSAGE.has(type),
            messageSource,
            currentUserId,
            normalizedBotUserId
        );

        return selectedMessages.map((message, index) => ({
            message,
            label: index === selectedMessages.length - 1
                ? "跳到最新符合條件的訊息"
                : `跳到符合條件的訊息 ${selectedMessages.length - index - 1}`
        }));
    }, [channelId, currentUserId, displayCount, messageSource, messages, navigationMode, normalizedBotUserId, turnJumpTarget]);
    const [scroller, setScroller] = useState<HTMLElement | null>(null);
    const [bounds, setBounds] = useState<DOMRect | null>(null);

    useLayoutEffect(() => {
        setScroller(findScrollableAncestor(hostElement));
    }, [channelId, hostElement]);

    useLayoutEffect(() => {
        if (!scroller) return;

        const updateBounds = () => setBounds(scroller.getBoundingClientRect());
        const resizeObserver = new ResizeObserver(updateBounds);
        resizeObserver.observe(scroller);
        window.addEventListener("resize", updateBounds);
        updateBounds();

        return () => {
            resizeObserver.disconnect();
            window.removeEventListener("resize", updateBounds);
        };
    }, [scroller]);

    const palette = useMemo(
        () => scroller ? getScrollerPalette(scroller) : null,
        [bounds, channelId, scroller, theme]
    );
    const canRenderPortal = !!channelId && !!bounds && !!palette && bounds.width >= 360 && navigationItems.length > 0;
    if (!canRenderPortal || !bounds || !palette) return null;

    const portalStyle: NavigatorPortalStyle = {
        right: window.innerWidth - bounds.right + NAVIGATOR_INSET,
        top: bounds.top + bounds.height / 2 + verticalOffset,
        "--vc-cn-normal": palette.normal,
        "--vc-cn-active": palette.active,
        "--vc-cn-hover": palette.hover,
        "--vc-cn-focus": palette.focus
    };

    return ReactDOM.createPortal(
        <div className="vc-conversation-navigator" style={portalStyle}>
            {navigationItems.map(({ message, label }, index) => (
                <NavigatorButton
                    key={message.id}
                    channelId={channelId}
                    message={message}
                    index={index}
                    count={navigationItems.length}
                    label={label}
                    showTooltip={showTooltip}
                    smoothScroll={smoothScroll}
                />
            ))}
        </div>,
        document.body
    );
}

const hostListeners = new Set<() => void>();
let activeHost: symbol | null = null;

function notifyHostListeners() {
    for (const listener of hostListeners) listener();
}

function useActiveHost() {
    const hostId = useRef(Symbol("conversation-navigator-host")).current;
    const [isActive, setIsActive] = useState(false);

    useLayoutEffect(() => {
        const update = () => {
            if (activeHost === null) activeHost = hostId;
            setIsActive(activeHost === hostId);
        };

        hostListeners.add(update);
        update();

        return () => {
            hostListeners.delete(update);
            if (activeHost === hostId) {
                activeHost = null;
                notifyHostListeners();
            }
        };
    }, [hostId]);

    return isActive;
}

function ConversationNavigatorHost() {
    const isActive = useActiveHost();
    const [hostElement, setHostElement] = useState<HTMLSpanElement | null>(null);
    const setHostRef = useCallback((element: HTMLSpanElement | null) => setHostElement(element), []);

    return (
        <>
            <span ref={setHostRef} className="vc-conversation-navigator-host" aria-hidden="true" />
            {isActive && hostElement && <ConversationNavigator hostElement={hostElement} />}
        </>
    );
}

const ConversationNavigatorDecoration: MessageDecorationFactory = ({ message }) => {
    const selectedChannelId = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getChannelId());
    return selectedChannelId === message.channel_id ? <ConversationNavigatorHost /> : null;
};

function migrateLegacyOnlyOwnMessages() {
    const legacySettings = settings.plain as Record<string, unknown>;
    if (Object.hasOwn(legacySettings, "messageSource") || typeof legacySettings.onlyOwnMessages !== "boolean") return;

    settings.store.messageSource = legacySettings.onlyOwnMessages
        ? MessageSource.MyMessages
        : MessageSource.HumanMessages;
}

export default definePlugin({
    name: "ConversationNavigator",
    description: "在目前聊天視窗中導覽最近的文字訊息或對話回合。",
    authors: [{ name: "eric99543", id: 0n }],
    tags: ["Chat", "Utility"],
    settings,
    start() {
        migrateLegacyOnlyOwnMessages();
    },
    renderMessageDecoration: ConversationNavigatorDecoration,
    flux: {
        CHANNEL_SELECT: cancelActiveJump
    },
    stop() {
        cancelActiveJump();
        activeHost = null;
        hostListeners.clear();
    }
});
