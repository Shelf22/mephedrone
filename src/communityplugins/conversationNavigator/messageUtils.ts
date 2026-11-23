/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Message } from "@vencord/discord-types";

export type IsUserMessageType = (type: Message["type"]) => boolean;
export const MessageSource = {
    HumanMessages: "humanMessages",
    MyMessages: "myMessages",
    HumansAndBots: "humansAndBots",
    SpecificBotOnly: "specificBotOnly",
    MyMessagesAndSpecificBot: "myMessagesAndSpecificBot"
} as const;
export type MessageSource = typeof MessageSource[keyof typeof MessageSource];

export const NavigationMode = {
    IndividualMessages: "individualMessages",
    ConversationTurns: "conversationTurns"
} as const;
export type NavigationMode = typeof NavigationMode[keyof typeof NavigationMode];

export const TurnJumpTarget = {
    UserPrompt: "userPrompt",
    FirstAgentMessage: "firstAgentMessage",
    LastAgentMessage: "lastAgentMessage"
} as const;
export type TurnJumpTarget = typeof TurnJumpTarget[keyof typeof TurnJumpTarget];

export interface ConversationTurn {
    id: string;
    promptMessage: Message;
    responseMessages: Message[];
    firstResponseMessage?: Message;
    lastResponseMessage?: Message;
    isPending: boolean;
}

const DISCORD_SNOWFLAKE = /^\d{17,20}$/;

function compareMessageIds(a: Message, b: Message) {
    return a.id === b.id ? 0 : BigInt(a.id) < BigInt(b.id) ? -1 : 1;
}

function isUsableTextMessage(message: Message, isUserMessageType: IsUserMessageType) {
    return message.deleted !== true
        && message.content.trim().length > 0
        && isUserMessageType(message.type);
}

function getMetadataTargetId(message: Message) {
    return message.messageReference?.message_id
        ?? message.interactionMetadata?.original_response_message_id
        ?? message.interactionMetadata?.interacted_message_id
        ?? message.interactionMetadata?.target_message_id
        ?? null;
}

export function normalizeBotUserId(value: string): string | null {
    const trimmed = value.trim();
    return DISCORD_SNOWFLAKE.test(trimmed) ? trimmed : null;
}

export function normalizeAndSortMessages(
    messages: readonly Message[],
    channelId: string | null,
    isUserMessageType: IsUserMessageType
) : Message[] {
    if (!channelId) return [];

    return messages
        .filter(message => message.channel_id === channelId && isUsableTextMessage(message, isUserMessageType))
        .sort(compareMessageIds);
}

export type MessageSelectionDiagnostic = {
    messageId: string;
    channelId: string;
    authorId: string | undefined;
    authorBot: boolean | undefined;
    hasWebhookId: boolean;
    type: Message["type"];
    contentLength: number;
    included: boolean;
    exclusionReason: string | null;
};

function matchesMessageSource(
    message: Message,
    source: MessageSource,
    currentUserId: string | null,
    botUserId: string | null
) {
    const authorId = message.author?.id;

    switch (source) {
        case MessageSource.HumanMessages:
            return message.author?.bot !== true && !message.webhookId;
        case MessageSource.MyMessages:
            return currentUserId !== null && authorId === currentUserId;
        case MessageSource.HumansAndBots:
            // Generic webhooks are not people or bot accounts. A configured bot is
            // still accepted by the ID-specific modes below, even when proxied by one.
            return !!authorId && !message.webhookId;
        case MessageSource.SpecificBotOnly:
            return botUserId !== null && authorId === botUserId;
        case MessageSource.MyMessagesAndSpecificBot:
            return (currentUserId !== null && authorId === currentUserId)
                || (botUserId !== null && authorId === botUserId);
    }
}

export function inspectMessageSelection(
    message: Message,
    channelId: string | null,
    isUserMessageType: IsUserMessageType,
    source: MessageSource,
    currentUserId: string | null,
    botUserId: string | null
): MessageSelectionDiagnostic {
    let exclusionReason: string | null = null;

    if (!channelId) exclusionReason = "noSelectedChannel";
    else if (message.channel_id !== channelId) exclusionReason = "differentChannel";
    else if (message.deleted === true) exclusionReason = "deleted";
    else if (message.content.trim().length === 0) exclusionReason = "emptyContent";
    else if (!isUserMessageType(message.type)) exclusionReason = "nonUserMessageType";
    else if (!matchesMessageSource(message, source, currentUserId, botUserId)) {
        switch (source) {
            case MessageSource.HumanMessages:
                exclusionReason = message.author?.bot === true ? "botAuthor" : "webhookMessage";
                break;
            case MessageSource.MyMessages:
                exclusionReason = currentUserId === null ? "missingCurrentUserId" : "differentAuthor";
                break;
            case MessageSource.HumansAndBots:
                exclusionReason = message.webhookId ? "genericWebhook" : "missingAuthorId";
                break;
            case MessageSource.SpecificBotOnly:
                exclusionReason = botUserId === null ? "invalidOrEmptyBotUserId" : "differentBotAuthor";
                break;
            case MessageSource.MyMessagesAndSpecificBot:
                exclusionReason = currentUserId === null && botUserId === null
                    ? "missingCurrentUserAndBotUserId"
                    : "differentAuthor";
                break;
        }
    }

    return {
        messageId: message.id,
        channelId: message.channel_id,
        authorId: message.author?.id,
        authorBot: message.author?.bot,
        hasWebhookId: !!message.webhookId,
        type: message.type,
        contentLength: message.content.length,
        included: exclusionReason === null,
        exclusionReason
    };
}

/**
 * Selects a stable, oldest-to-newest snapshot of recent text messages.
 * The caller supplies the version-specific user-message type predicate so this
 * module remains deterministic and directly testable outside Discord.
 */
export function selectRecentTextMessages(
    messages: readonly Message[],
    channelId: string | null,
    limit: number,
    isUserMessageType: IsUserMessageType,
    source: MessageSource,
    currentUserId: string | null = null,
    botUserId: string | null = null
): Message[] {
    if (!channelId || limit < 1) return [];

    return normalizeAndSortMessages(messages, channelId, isUserMessageType)
        .filter(message => matchesMessageSource(message, source, currentUserId, botUserId))
        .slice(-limit);
}

function addResponseMessage(turn: ConversationTurn, message: Message, turnByMessageId: Map<string, ConversationTurn>) {
    turn.responseMessages.push(message);
    turn.firstResponseMessage ??= message;
    turn.lastResponseMessage = message;
    turn.isPending = false;
    turnByMessageId.set(message.id, turn);
}

/**
 * Builds current-user prompt turns from the loaded channel snapshot. Metadata is
 * used only when it resolves to a known prompt or response in that snapshot.
 * Otherwise, a valid agent message follows the most recent open turn.
 */
export function buildConversationTurns(
    messages: readonly Message[],
    channelId: string | null,
    isUserMessageType: IsUserMessageType,
    currentUserId: string | null,
    botUserId: string | null
): ConversationTurn[] {
    if (!channelId || !currentUserId || !botUserId) return [];

    const channelMessages = messages
        .filter(message => message.channel_id === channelId)
        .slice()
        .sort(compareMessageIds);
    const deletedPromptIds = new Set(channelMessages
        .filter(message => message.author?.id === currentUserId && message.deleted === true)
        .map(message => message.id));
    const turns: ConversationTurn[] = [];
    const turnByMessageId = new Map<string, ConversationTurn>();
    let currentTurn: ConversationTurn | null = null;

    for (const message of channelMessages) {
        const isCurrentUserMessage = message.author?.id === currentUserId;
        const isAgentMessage = message.author?.id === botUserId;

        if (isCurrentUserMessage) {
            if (message.deleted === true) {
                currentTurn = null;
                continue;
            }
            if (!isUsableTextMessage(message, isUserMessageType)) continue;

            currentTurn = {
                id: message.id,
                promptMessage: message,
                responseMessages: [],
                isPending: true
            };
            turns.push(currentTurn);
            turnByMessageId.set(message.id, currentTurn);
            continue;
        }

        if (!isAgentMessage || !isUsableTextMessage(message, isUserMessageType)) continue;

        const metadataTargetId = getMetadataTargetId(message);
        const metadataTurn = metadataTargetId ? turnByMessageId.get(metadataTargetId) : undefined;
        if (metadataTurn) {
            addResponseMessage(metadataTurn, message, turnByMessageId);
            continue;
        }
        if (metadataTargetId && deletedPromptIds.has(metadataTargetId)) continue;
        if (currentTurn) addResponseMessage(currentTurn, message, turnByMessageId);
    }

    return turns;
}

export function selectRecentConversationTurns(
    messages: readonly Message[],
    channelId: string | null,
    limit: number,
    isUserMessageType: IsUserMessageType,
    currentUserId: string | null,
    botUserId: string | null
): ConversationTurn[] {
    if (limit < 1) return [];

    return buildConversationTurns(messages, channelId, isUserMessageType, currentUserId, botUserId)
        .slice(-limit);
}

export function getTurnTargetMessage(turn: ConversationTurn, target: TurnJumpTarget): Message {
    switch (target) {
        case TurnJumpTarget.FirstAgentMessage:
            return turn.firstResponseMessage ?? turn.promptMessage;
        case TurnJumpTarget.LastAgentMessage:
            return turn.lastResponseMessage ?? turn.promptMessage;
        case TurnJumpTarget.UserPrompt:
            return turn.promptMessage;
    }
}

export function calculateFirstLineScrollDelta(
    firstLineTop: number,
    scrollerTop: number,
    scrollerHeight: number,
    scrollerClientHeight: number
) {
    const desiredTop = scrollerTop + Math.min(scrollerHeight, scrollerClientHeight) / 2;
    return firstLineTop - desiredTop;
}

export function calculateMissingScrollSpace(currentScrollTop: number, maxScrollTop: number, delta: number) {
    return Math.max(0, currentScrollTop + delta - maxScrollTop);
}

export function isWithinScrollTolerance(delta: number, tolerance = 2) {
    return Math.abs(delta) <= tolerance;
}
