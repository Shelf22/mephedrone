/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";

import type { Message } from "@vencord/discord-types";

import { buildConversationTurns, calculateFirstLineScrollDelta, calculateMissingScrollSpace, getTurnTargetMessage, isWithinScrollTolerance, MessageSource, normalizeBotUserId, selectRecentConversationTurns, selectRecentTextMessages, TurnJumpTarget } from "./messageUtils";

const humanText = (id: string, channelId = "channel-a", overrides: Partial<Message> = {}) => ({
    id,
    channel_id: channelId,
    content: "text",
    author: { id: "person", bot: false },
    type: 0,
    ...overrides
}) as Message;

const selectedIds = (messages: Message[], source: MessageSource = MessageSource.HumanMessages, channelId = "channel-a", currentUserId: string | null = null, botUserId: string | null = null) => selectRecentTextMessages(
    messages,
    channelId,
    3,
    type => type === 0,
    source,
    currentUserId,
    botUserId
).map(message => message.id);

assert.deepEqual(selectedIds([
    humanText("3"),
    humanText("1", "channel-b"),
    humanText("2", "channel-a", { author: { id: "bot", bot: true } as Message["author"] }),
    humanText("4", "channel-a", { webhookId: "webhook" }),
    humanText("5", "channel-a", { content: "   " }),
    humanText("6", "channel-a", { type: 1 as Message["type"] }),
    humanText("7"),
    humanText("9"),
    humanText("8")
]), ["7", "8", "9"], "human mode filters bot, webhook, empty, system, and other-channel messages; keeps newest three oldest-to-newest");

assert.deepEqual(selectedIds([humanText("2"), humanText("1")]), ["1", "2"], "supports fewer than three messages");
assert.deepEqual(selectedIds([humanText("1"), humanText("2", "channel-a", { deleted: true }), humanText("3")]), ["1", "3"], "updates after deletion");

assert.deepEqual(
    selectedIds([humanText("1"), humanText("2", "channel-a", { author: { id: "other", bot: false } as Message["author"] })], MessageSource.MyMessages, "channel-a", "person"),
    ["1"],
    "my-messages mode excludes other authors"
);

const botMessage = (id: string, overrides: Partial<Message> = {}) => humanText(id, "channel-a", {
    author: { id: "bot-a", bot: true } as Message["author"],
    ...overrides
});

assert.deepEqual(selectedIds([botMessage("1")], MessageSource.HumansAndBots), ["1"], "humans-and-bots mode includes ordinary bot messages");
assert.deepEqual(selectedIds([botMessage("1"), botMessage("2", { author: { id: "bot-b", bot: true } as Message["author"] })], MessageSource.SpecificBotOnly, "channel-a", null, "bot-a"), ["1"], "specific-bot mode includes only the configured bot");
assert.deepEqual(selectedIds([humanText("1"), botMessage("2")], MessageSource.SpecificBotOnly, "channel-a", null, "bot-a"), ["2"], "specific-bot mode excludes humans");
assert.deepEqual(selectedIds([botMessage("1", { webhookId: "webhook" })], MessageSource.SpecificBotOnly, "channel-a", null, "bot-a"), ["1"], "specific bot is retained when Discord proxies it through a webhook");
assert.deepEqual(selectedIds([botMessage("1")], MessageSource.SpecificBotOnly, "channel-a", null, normalizeBotUserId("   ")), [], "empty bot ID matches nothing");
assert.equal(normalizeBotUserId("not-a-snowflake"), null, "invalid bot ID is rejected safely");
assert.equal(normalizeBotUserId(" 123456789012345678 "), "123456789012345678", "valid bot ID is trimmed");
assert.deepEqual(selectedIds([humanText("1"), botMessage("2"), humanText("3", "channel-a", { author: { id: "other", bot: false } as Message["author"] })], MessageSource.MyMessagesAndSpecificBot, "channel-a", "person", "bot-a"), ["1", "2"], "combined mode includes the current user and configured bot only");
assert.deepEqual(selectedIds([botMessage("1", { type: 1 as Message["type"] })], MessageSource.HumansAndBots), [], "system messages remain excluded in every source mode");

const turns = (messages: Message[]) => buildConversationTurns(
    messages,
    "channel-a",
    type => type === 0 || type === 19,
    "person",
    "bot-a"
);
const turnIds = (messages: Message[], limit = 3) => selectRecentConversationTurns(
    messages,
    "channel-a",
    limit,
    type => type === 0 || type === 19,
    "person",
    "bot-a"
).map(turn => turn.id);

assert.deepEqual(turns([humanText("1"), botMessage("2")]).map(turn => [turn.id, turn.responseMessages.map(message => message.id), turn.isPending]), [["1", ["2"], false]], "one prompt and one agent message make one completed turn");
assert.deepEqual(turns([humanText("1"), botMessage("2"), botMessage("3"), botMessage("4")])[0].responseMessages.map(message => message.id), ["2", "3", "4"], "multiple agent segments remain in one turn");
assert.deepEqual(turns([humanText("1"), botMessage("2"), humanText("3"), botMessage("4")]).map(turn => [turn.id, turn.responseMessages.map(message => message.id)]), [["1", ["2"]], ["3", ["4"]]], "two prompt-response pairs make two oldest-to-newest turns");
assert.deepEqual(turnIds([humanText("1"), botMessage("2"), botMessage("3"), humanText("4"), botMessage("5"), humanText("6"), botMessage("7"), humanText("8")], 2), ["6", "8"], "display count selects turns rather than individual messages");
assert.deepEqual(turns([humanText("1")]).map(turn => [turn.id, turn.responseMessages.length, turn.isPending]), [["1", 0, true]], "pending prompts still create turns");
assert.deepEqual(turns([botMessage("1"), humanText("2"), botMessage("3")]).map(turn => [turn.id, turn.responseMessages.map(message => message.id)]), [["2", ["3"]]], "agent messages before the first prompt are ignored");
assert.deepEqual(turns([humanText("1"), botMessage("2", { author: { id: "bot-b", bot: true } as Message["author"] }), humanText("3", "channel-a", { author: { id: "other", bot: false } as Message["author"] }), botMessage("4")])[0].responseMessages.map(message => message.id), ["4"], "other bots and people do not alter the active turn");
assert.deepEqual(turns([humanText("1", "channel-b"), botMessage("2", { channel_id: "channel-b" })]), [], "turns do not mix channels");
assert.deepEqual(turns([humanText("1", "channel-a", { type: 1 as Message["type"] }), humanText("2", "channel-a", { content: "   " }), humanText("3"), botMessage("4", { type: 1 as Message["type"] }), botMessage("5", { content: " " }), botMessage("6")])[0].responseMessages.map(message => message.id), ["6"], "system and empty messages are excluded from turns");
assert.deepEqual(turns([humanText("1"), botMessage("2"), botMessage("3", { deleted: true })]).map(turn => [turn.id, turn.responseMessages.map(message => message.id)]), [["1", ["2"]]], "deleting one agent segment retains its prompt turn");
assert.deepEqual(turns([humanText("1"), botMessage("2"), humanText("3", "channel-a", { deleted: true }), botMessage("4")]).map(turn => turn.id), ["1"], "deleting a prompt removes its turn and does not merge later agent text into the prior turn");

const targetTurn = turns([humanText("1"), botMessage("2"), botMessage("3")])[0];
assert.equal(getTurnTargetMessage(targetTurn, TurnJumpTarget.UserPrompt).id, "1", "user prompt is the default turn target");
assert.equal(getTurnTargetMessage(targetTurn, TurnJumpTarget.FirstAgentMessage).id, "2", "first agent target selects the first segment");
assert.equal(getTurnTargetMessage(targetTurn, TurnJumpTarget.LastAgentMessage).id, "3", "last agent target selects the last segment");
assert.equal(getTurnTargetMessage(turns([humanText("1")])[0], TurnJumpTarget.FirstAgentMessage).id, "1", "pending first-agent target falls back to prompt");
assert.equal(getTurnTargetMessage(turns([humanText("1")])[0], TurnJumpTarget.LastAgentMessage).id, "1", "pending last-agent target falls back to prompt");
assert.deepEqual(turns([humanText("1"), botMessage("2", { type: 19 as Message["type"] })])[0].responseMessages.map(message => message.id), ["2"], "agent reply type 19 is accepted when the caller permits it");
assert.deepEqual(turns([humanText("10"), humanText("20"), botMessage("30", { messageReference: { channel_id: "channel-a", message_id: "10" } })]).map(turn => [turn.id, turn.responseMessages.map(message => message.id)]), [["10", ["30"]], ["20", []]], "reply metadata assigns a delayed agent segment to its earlier prompt");
assert.deepEqual(turns([humanText("1"), botMessage("2"), humanText("3"), botMessage("4")]).map(turn => turn.responseMessages.map(message => message.id)), [["2"], ["4"]], "missing metadata uses chronological fallback");
assert.deepEqual(buildConversationTurns([humanText("1"), botMessage("2")], "channel-a", type => type === 0, "person", null), [], "an invalid or empty bot ID produces no turns");

const threeTargetTurns = turns([
    humanText("100"), botMessage("101"), botMessage("102"), botMessage("103"),
    humanText("200"), botMessage("201"), botMessage("202"),
    humanText("300"), botMessage("301"), botMessage("302"), botMessage("303"), botMessage("304")
]);
assert.deepEqual(threeTargetTurns.map(turn => getTurnTargetMessage(turn, TurnJumpTarget.LastAgentMessage).id), ["103", "202", "304"], "last-agent targets stay oldest-to-newest, so the bottom bar targets the latest turn");
assert.deepEqual(threeTargetTurns.map(turn => getTurnTargetMessage(turn, TurnJumpTarget.FirstAgentMessage).id), ["101", "201", "301"], "first-agent targets stay aligned with all three turn bars");
assert.deepEqual(threeTargetTurns.map(turn => getTurnTargetMessage(turn, TurnJumpTarget.UserPrompt).id), ["100", "200", "300"], "prompt targets stay aligned with all three turn bars");
assert.equal(getTurnTargetMessage(threeTargetTurns.at(-1)!, TurnJumpTarget.LastAgentMessage).id, "304", "the bottom bar's latest turn targets 304");
assert.equal(getTurnTargetMessage(threeTargetTurns[1], TurnJumpTarget.LastAgentMessage).id, "202", "the middle bar targets 202");
assert.equal(getTurnTargetMessage(threeTargetTurns[0], TurnJumpTarget.LastAgentMessage).id, "103", "the top bar targets 103");

assert.equal(calculateFirstLineScrollDelta(700, 100, 800, 600), 300, "scroll delta centres the first rendered line using the actual client viewport height");
assert.equal(calculateFirstLineScrollDelta(250, 100, 800, 600), -150, "negative delta scrolls upward");
assert.equal(calculateMissingScrollSpace(300, 700, 200), 0, "a target away from the channel bottom needs no extra scroll space");
assert.equal(calculateMissingScrollSpace(650, 700, 120), 70, "a near-bottom target reports the exact missing scroll space");
assert.equal(calculateMissingScrollSpace(720, 700, -80), 0, "upward corrections never request bottom spacing");
assert.equal(isWithinScrollTolerance(2), true, "two pixels is within the final positioning tolerance");
assert.equal(isWithinScrollTolerance(2.1), false, "errors above two pixels require another reconciliation pass");
