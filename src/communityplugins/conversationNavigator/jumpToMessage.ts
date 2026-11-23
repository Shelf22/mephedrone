/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MessageActions, SelectedChannelStore, showToast, Toasts } from "@webpack/common";

import { calculateFirstLineScrollDelta, calculateMissingScrollSpace, isWithinScrollTolerance } from "./messageUtils";

const JUMP_TIMEOUT_MS = 2000;
const STABILIZATION_TIMEOUT_MS = 800;
const SCROLL_TOLERANCE_PX = 2;

let activeJump: AbortController | null = null;
let activeSpacer: HTMLElement | null = null;
let activeSpacerScroller: HTMLElement | null = null;
let activeSpacerHeight = 0;

export function cancelActiveJump() {
    activeJump?.abort();
    activeJump = null;
    activeSpacer?.remove();
    activeSpacer = null;
    activeSpacerScroller = null;
    activeSpacerHeight = 0;
}

function nextAnimationFrame(signal: AbortSignal) {
    return new Promise<boolean>(resolve => {
        if (signal.aborted) return resolve(false);

        const frame = requestAnimationFrame(() => resolve(!signal.aborted));
        signal.addEventListener("abort", () => {
            cancelAnimationFrame(frame);
            resolve(false);
        }, { once: true });
    });
}

function findScrollableAncestor(element: HTMLElement) {
    for (let current: HTMLElement | null = element; current; current = current.parentElement) {
        const { overflowY } = getComputedStyle(current);
        if (current.scrollHeight > current.clientHeight && /auto|scroll|overlay/.test(overflowY)) {
            return current;
        }
    }

    return null;
}

function getMessageContent(messageId: string) {
    const target = document.getElementById(`message-content-${messageId}`) as HTMLElement | null;
    return target?.isConnected ? target : null;
}

function findCurrentChatScroller() {
    for (const messageContent of document.querySelectorAll<HTMLElement>('[id^="message-content-"]')) {
        const scroller = findScrollableAncestor(messageContent);
        if (scroller) return scroller;
    }

    return null;
}

function waitForTargetMessage(messageId: string, scroller: HTMLElement | null, signal: AbortSignal) {
    return new Promise<HTMLElement | null>(resolve => {
        let observer: MutationObserver | undefined;
        const timeout = window.setTimeout(() => finish(null), JUMP_TIMEOUT_MS);

        const finish = (element: HTMLElement | null) => {
            observer?.disconnect();
            clearTimeout(timeout);
            resolve(element);
        };

        const check = () => {
            if (signal.aborted) return finish(null);

            const target = getMessageContent(messageId);
            if (target) finish(target);
        };

        signal.addEventListener("abort", () => finish(null), { once: true });

        requestAnimationFrame(() => {
            if (signal.aborted) return finish(null);

            if (scroller) {
                observer = new MutationObserver(check);
                observer.observe(scroller, { childList: true, subtree: true });
            }
            check();
        });
    });
}

function waitForScrollSettle(scroller: HTMLElement, signal: AbortSignal, timeoutMs: number) {
    return new Promise<void>(resolve => {
        const timeout = window.setTimeout(finish, timeoutMs);

        function finish() {
            clearTimeout(timeout);
            scroller.removeEventListener("scrollend", finish);
            signal.removeEventListener("abort", finish);
            resolve();
        }

        scroller.addEventListener("scrollend", finish, { once: true });
        signal.addEventListener("abort", finish, { once: true });
    });
}

function getFirstRenderedLineRect(messageContent: HTMLElement) {
    const walker = document.createTreeWalker(messageContent, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode() as Text | null;

    while (textNode) {
        const text = textNode.textContent ?? "";
        const firstNonWhitespace = text.search(/\S/);
        if (firstNonWhitespace >= 0) {
            const range = document.createRange();
            range.setStart(textNode, firstNonWhitespace);
            range.setEnd(textNode, text.length);

            for (const rect of range.getClientRects()) {
                if (rect.width > 0 && rect.height > 0) return rect;
            }
        }

        textNode = walker.nextNode() as Text | null;
    }

    for (const rect of messageContent.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) return rect;
    }

    const fallbackRect = messageContent.getBoundingClientRect();
    return fallbackRect.width > 0 && fallbackRect.height > 0 ? fallbackRect : null;
}

function getScrollContentCandidates(scroller: HTMLElement, target: HTMLElement) {
    const candidates: HTMLElement[] = [];
    for (let current = target.parentElement; current && current !== scroller; current = current.parentElement) {
        candidates.push(current);
    }

    return candidates.reverse();
}

function updateSpacerHeight(spacer: HTMLElement, height: number) {
    spacer.style.height = `${height}px`;
    spacer.style.minHeight = `${height}px`;
    spacer.style.flex = `0 0 ${height}px`;
}

async function ensureBottomScrollSpace(scroller: HTMLElement, target: HTMLElement, missingScrollSpace: number, signal: AbortSignal) {
    const requestedHeight = Math.ceil(missingScrollSpace) + 8;

    for (const candidate of getScrollContentCandidates(scroller, target)) {
        const previousScrollHeight = scroller.scrollHeight;
        const spacer = document.createElement("div");
        spacer.className = "vc-conversation-navigator-bottom-spacer";
        spacer.dataset.vcConversationNavigatorSpacer = "true";
        spacer.setAttribute("aria-hidden", "true");
        spacer.style.pointerEvents = "none";
        updateSpacerHeight(spacer, requestedHeight);
        candidate.append(spacer);

        if (!await nextAnimationFrame(signal)) {
            spacer.remove();
            return false;
        }

        if (scroller.scrollHeight >= previousScrollHeight + requestedHeight) {
            activeSpacer?.remove();
            activeSpacer = spacer;
            activeSpacerScroller = scroller;
            activeSpacerHeight = requestedHeight;
            return true;
        }

        spacer.remove();
    }

    return false;
}

async function centreMessageFirstLine(target: HTMLElement, smooth: boolean, signal: AbortSignal) {
    const scroller = findScrollableAncestor(target);
    if (!scroller || signal.aborted) return false;

    const deadline = performance.now() + STABILIZATION_TIMEOUT_MS;
    if (!await nextAnimationFrame(signal) || !await nextAnimationFrame(signal)) return false;

    for (let attempt = 0; attempt < 4 && performance.now() < deadline; attempt++) {
        if (signal.aborted || !target.isConnected || !scroller.isConnected) return false;

        const firstLineRect = getFirstRenderedLineRect(target);
        if (!firstLineRect) return false;

        const scrollerRect = scroller.getBoundingClientRect();
        const delta = calculateFirstLineScrollDelta(
            firstLineRect.top,
            scrollerRect.top,
            scrollerRect.height,
            scroller.clientHeight
        );
        if (isWithinScrollTolerance(delta, SCROLL_TOLERANCE_PX)) return true;

        const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const missingScrollSpace = calculateMissingScrollSpace(scroller.scrollTop, maxScrollTop, delta);
        if (missingScrollSpace > SCROLL_TOLERANCE_PX) {
            if (activeSpacerScroller !== scroller) {
                activeSpacer?.remove();
                activeSpacer = null;
                activeSpacerScroller = null;
                activeSpacerHeight = 0;
            }
            if (!activeSpacer && !await ensureBottomScrollSpace(scroller, target, missingScrollSpace, signal)) return false;
            if (activeSpacer && activeSpacerScroller === scroller && activeSpacerHeight < missingScrollSpace) {
                const previousScrollHeight = scroller.scrollHeight;
                const additionalHeight = Math.ceil(missingScrollSpace - activeSpacerHeight) + 8;
                updateSpacerHeight(activeSpacer, activeSpacerHeight + additionalHeight);
                if (!await nextAnimationFrame(signal) || scroller.scrollHeight < previousScrollHeight + additionalHeight) return false;
                activeSpacerHeight += additionalHeight;
            }
        }

        scroller.scrollBy({ top: delta, behavior: attempt === 0 && smooth ? "smooth" : "auto" });
        if (attempt === 0 && smooth) {
            const remaining = Math.max(0, deadline - performance.now());
            await waitForScrollSettle(scroller, signal, Math.min(350, remaining));
        }
        if (!await nextAnimationFrame(signal)) return false;
    }

    return !signal.aborted;
}

/**
 * The jump API and message-content id are both used by this checkout's
 * official QuickReply plugin. The observer is intentionally scoped to the
 * current chat scroller and is removed on success, timeout, or cancellation.
 */
export async function jumpToMessage(channelId: string, messageId: string, smooth: boolean) {
    cancelActiveJump();
    const controller = activeJump = new AbortController();

    MessageActions.jumpToMessage({
        channelId,
        messageId,
        flash: false,
        jumpType: "INSTANT"
    });

    const existingTarget = getMessageContent(messageId);
    const target = await waitForTargetMessage(messageId, (existingTarget ? findScrollableAncestor(existingTarget) : null) ?? findCurrentChatScroller(), controller.signal);
    if (!target || controller.signal.aborted || SelectedChannelStore.getChannelId() !== channelId) {
        if (!controller.signal.aborted) {
            showToast("找不到要跳轉的訊息", Toasts.Type.FAILURE);
        }
        return;
    }

    await centreMessageFirstLine(target, smooth, controller.signal);
    if (activeJump === controller) activeJump = null;
}
