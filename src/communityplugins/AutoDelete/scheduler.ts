/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 KernelSpecter
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { del, get, set } from "@api/DataStore";
import { updateMessage } from "@api/MessageUpdater";
import { showNotice } from "@api/Notices";
import { Logger } from "@utils/Logger";
import { findByPropsLazy } from "@webpack";
import { Constants, FluxDispatcher, RestAPI } from "@webpack/common";

import { getMessage } from "./chain";
import { MAX_TTL, MIN_TTL } from "./duration";
import { exemption } from "./rules";
import { settings } from "./settings";

const ThreadActions = findByPropsLazy("unarchiveThreadIfNecessary");

const logger = new Logger("AutoDelete");

const STORE_KEY = "AutoDelete_pending_v2";
/** setTimeout fires immediately past this, so never hand it a bigger delay. */
const MAX_TIMEOUT = 2 ** 31 - 1;
/** Deliberately slower than the normal pace: a catch-up batch is the one moment this looks like a bot. */
const CATCH_UP_INTERVAL_MS = 2500;
/** For an error that will not fix itself: a refusal gets one more go, then stops. */
const MAX_ATTEMPTS = 2;
/** For one that will. A rate limit is not a refusal, it is "not yet", so it gets
 *  its own generous budget and does not spend the one above. */
const MAX_TRANSIENT_ATTEMPTS = 40;
/** However patient it is, a message does not sit in the queue being retried forever. */
const MAX_RETRY_SPAN_MS = 10 * 60_000;

export interface Pending {
    channelId: string;
    messageId: string;
    deleteAt: number;
    createdAt: number;
    reason: string;
    attempts: number;
    /** Rate limits and server errors, counted apart from refusals. */
    holds?: number;
    /** When we first tried, so patience has a limit even when the errors are transient. */
    firstTriedAt?: number;
}

/** messageId -> entry. Kept in memory so the countdown can read it synchronously while rendering. */
const pending = new Map<string, Pending>();
const inFlight = new Set<string>();
const queue: Pending[] = [];

let wheel: ReturnType<typeof setTimeout> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let draining = false;
let catchUpRemaining = 0;
let consecutiveFailures = 0;
let running = false;
/** Set by a 429: the whole queue waits, because the next delete hits the same wall. */
let holdUntil = 0;
/** When the last request came back. The gap is kept from here, across drains as well as within one. */
let lastRequestAt = 0;

export const stats = {
    /** Armed this session. Pending far below this after a burst means the arming
     *  never happened, which is a different fault from a delete that was refused. */
    armed: 0,
    deleted: 0,
    failed: 0,
    skipped: 0,
    rateLimited: 0,
    lastError: null as string | null,
    lastCode: null as string | number | null
};

/**
 * How long to wait before trying this one again, or null if trying again is pointless.
 *
 * Discord's message-delete bucket is small and per-channel, so a burst of your own
 * messages coming due together walks straight into it. A 429 says when to come back;
 * every attempt used to count the same as a permission error, so two of them wrote
 * the message off and it silently stayed up. That is the bug this exists to stop.
 */
function retryDelay(err: any): number | null {
    const status = Number(err?.status ?? err?.body?.status ?? err?.httpStatus);
    const code = err?.body?.code ?? err?.code;
    // A 429 from the edge has no JSON body, so the header, which Discord's client reads
    // into retryAfter, is all there is to go on.
    const after = Number(err?.body?.retry_after ?? err?.retry_after ?? err?.body?.retryAfter ?? err?.retryAfter);

    if (status === 429 || code === 429) {
        return Math.max(Number.isFinite(after) ? after * 1000 : 1000, 250);
    }
    // A gateway or server error, however it arrives: theirs to fix, not ours.
    if (Number.isFinite(status) && status >= 500) return 2000;
    if (Number.isFinite(Number(code)) && Number(code) >= 500 && Number(code) < 600) return 2000;
    // No status and no Discord error code at all is a dropped connection, not a no.
    if (!Number.isFinite(status) && code == null) return 2000;
    return null;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function refresh(entry: Pick<Pending, "channelId" | "messageId">) {
    if (!settings.store.showCountdown) return;
    try {
        updateMessage(entry.channelId, entry.messageId);
    } catch {
        // Not cached, so there is nothing on screen to refresh.
    }
}

// ---------------------------------------------------------------- persistence

function persistSoon() {
    // A request that lands after shutdown() would otherwise save the emptied memory
    // over the queue shutdown() just wrote.
    if (saveTimer != null || !running) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        void persistNow();
    }, 1500);
}

async function persistNow() {
    try {
        if (pending.size === 0) await del(STORE_KEY);
        else await set(STORE_KEY, [...pending.values()]);
    } catch (err) {
        logger.error("Could not save the pending queue", err);
    }
}

function isPlausible(entry: any): entry is Pending {
    return Boolean(entry)
        && typeof entry.channelId === "string"
        && typeof entry.messageId === "string"
        && Number.isFinite(entry.deleteAt);
}

// ---------------------------------------------------------------- the wheel

/** One timer for the whole queue, aimed at the nearest deadline. */
function rearm() {
    if (wheel != null) {
        clearTimeout(wheel);
        wheel = null;
    }
    if (!running) return;

    let soonest = Infinity;
    for (const entry of pending.values()) {
        if (inFlight.has(entry.messageId)) continue;
        if (entry.deleteAt < soonest) soonest = entry.deleteAt;
    }
    if (!Number.isFinite(soonest)) return;

    const delay = Math.min(Math.max(soonest - Date.now(), 0), MAX_TIMEOUT);
    wheel = setTimeout(tick, delay);
}

function tick() {
    // Called directly by deleteSoon() and resume() as well as by the wheel itself.
    // Dropping the handle without clearing it left the old timer live, and every
    // direct call leaked another one.
    if (wheel != null) clearTimeout(wheel);
    wheel = null;

    const now = Date.now();
    const due = [...pending.values()]
        .filter(entry => !inFlight.has(entry.messageId) && entry.deleteAt <= now)
        .sort((a, b) => a.deleteAt - b.deleteAt);

    for (const entry of due) {
        inFlight.add(entry.messageId);
        queue.push(entry);
    }

    rearm();
    void drain();
}

// ---------------------------------------------------------------- the queue

function pace() {
    const base = catchUpRemaining > 0
        ? Math.max(CATCH_UP_INTERVAL_MS, settings.store.minIntervalMs)
        : settings.store.minIntervalMs;

    // Something is going wrong repeatedly. Slow down rather than hammer.
    return Math.min(base * 2 ** Math.min(consecutiveFailures, 4), 30_000);
}

function drop(messageId: string) {
    pending.delete(messageId);
    inFlight.delete(messageId);
    persistSoon();
}

async function drain() {
    if (draining) return;
    draining = true;

    try {
        while (queue.length > 0 && running) {
            // A 429 applies to the channel, not to the one message that got it. The gap
            // is measured from the last request rather than slept after each one, so a
            // queue that empties and refills a moment later still keeps it.
            const wait = Math.max(holdUntil, lastRequestAt + pace()) - Date.now();
            if (wait > 0) {
                await sleep(wait);
                continue;
            }

            const entry = queue.shift()!;
            if (catchUpRemaining > 0) catchUpRemaining--;

            await performDelete(entry);
        }
    } finally {
        draining = false;
        if (queue.length === 0) catchUpRemaining = 0;
        rearm();
    }
}

async function performDelete(entry: Pending) {
    const { channelId, messageId } = entry;

    // It may have been pinned, or edited to say !keep, since it was queued.
    const live = getMessage(channelId, messageId);
    if (live) {
        const why = exemption(live);
        if (why) {
            if (settings.store.logToConsole) logger.info(`Left ${messageId} alone: ${why}`);
            stats.skipped++;
            drop(messageId);
            refresh(entry);
            return;
        }
    }

    if (settings.store.dryRun) {
        logger.info(`Dry run: would delete ${messageId} in ${channelId} (${entry.reason})`);
        stats.skipped++;
        drop(messageId);
        refresh(entry);
        return;
    }

    await unarchiveIfNeeded(channelId);

    try {
        // Not MessageActions.deleteMessage. That one starts the request and returns
        // without waiting for it, so it resolves at once and never rejects: every
        // message counted as deleted the moment the request left, and one that then
        // hit a rate limit stayed up with nothing tracking it any more. Spam is exactly
        // what fills the per-channel delete bucket, so spam is where messages were lost.
        await RestAPI.del({ url: Constants.Endpoints.MESSAGE(channelId, messageId), oldFormErrors: true });
    } catch (err: any) {
        lastRequestAt = Date.now();

        const code = err?.body?.code ?? err?.code;

        // 10008 Unknown Message: already gone, which is the outcome we wanted anyway.
        if (code === 10008) {
            drop(messageId);
            return;
        }

        const wait = retryDelay(err);
        if (entry.firstTriedAt == null) entry.firstTriedAt = Date.now();
        stats.lastError = err?.body?.message ?? err?.message ?? (err?.status ? `HTTP ${err.status}` : String(err));
        stats.lastCode = code ?? err?.status ?? null;

        let spent: number;
        if (wait == null) {
            // A refusal. Trying harder will not change the answer.
            entry.attempts++;
            consecutiveFailures++;
            spent = entry.attempts;
        } else {
            stats.rateLimited++;
            entry.holds = (entry.holds ?? 0) + 1;
            spent = entry.holds;
            // Hold the queue, not just this entry: the next one hits the same limit.
            holdUntil = Math.max(holdUntil, Date.now() + wait);
        }

        const ceiling = wait == null ? MAX_ATTEMPTS : MAX_TRANSIENT_ATTEMPTS;
        const tooLong = Date.now() - entry.firstTriedAt > MAX_RETRY_SPAN_MS;
        if (spent >= ceiling || tooLong) {
            stats.failed++;
            logger.error(`Giving up on ${messageId} after ${entry.attempts + (entry.holds ?? 0)} attempts: ${stats.lastError}`);
            drop(messageId);
            return;
        }

        // One more go, when it is worth having.
        entry.deleteAt = Date.now() + (wait ?? pace());
        persistSoon();

        if (wait != null && running && pending.get(messageId) === entry) {
            // A limit is not this message's fault. Sent to the back of everything else
            // that is due, a big burst could run out its patience while it waited its
            // turn, so it keeps its place and goes first once the hold lifts.
            queue.unshift(entry);
            return;
        }

        inFlight.delete(messageId);
        rearm();
        return;
    }

    lastRequestAt = Date.now();
    stats.deleted++;
    consecutiveFailures = 0;
    holdUntil = 0;
    drop(messageId);
    removeLocally(channelId, messageId);
    if (settings.store.logToConsole) logger.info(`Deleted ${messageId} (${entry.reason})`);
}

/** Discord's own delete reopens an archived thread first. Without that the delete is refused. */
async function unarchiveIfNeeded(channelId: string) {
    try {
        await ThreadActions.unarchiveThreadIfNecessary(channelId);
    } catch {
        // Not found, or not allowed. The delete that follows reports what actually happened.
    }
}

/** Discord takes a message off screen as soon as its own delete succeeds, not when the gateway echoes it. */
function removeLocally(channelId: string, messageId: string) {
    try {
        void FluxDispatcher.dispatch({ type: "MESSAGE_DELETE", id: messageId, channelId });
    } catch {
        // The gateway will do it a moment later anyway.
    }
}

// ---------------------------------------------------------------- public API

export function getPending(messageId: string): Pending | undefined {
    return pending.get(messageId);
}

export function pendingCount() {
    return pending.size;
}

export function pendingEntries(): Pending[] {
    return [...pending.values()];
}

export function isCatchingUp() {
    return catchUpRemaining > 0;
}

/**
 * Arms a message for deletion. Jitter is added on top of the timer, never taken off,
 * so a message never dies sooner than you asked for.
 */
export function schedule(channelId: string, messageId: string, ttlSeconds: number, reason: string): Pending | null {
    if (!running || !channelId || !messageId) return null;

    const already = pending.get(messageId);
    if (already) return already;

    const ttl = Math.min(Math.max(ttlSeconds, MIN_TTL), MAX_TTL);
    const jitter = Math.max(0, Math.min(settings.store.jitterPercent, 100)) / 100;
    const spread = ttl * jitter * Math.random();

    const entry: Pending = {
        channelId,
        messageId,
        deleteAt: Date.now() + (ttl + spread) * 1000,
        createdAt: Date.now(),
        reason,
        attempts: 0
    };

    pending.set(messageId, entry);
    stats.armed++;
    persistSoon();
    rearm();
    refresh(entry);

    return entry;
}

/** Stop tracking a message without deleting it. */
export function keep(messageId: string): boolean {
    const entry = pending.get(messageId);
    if (!entry) return false;

    const index = queue.findIndex(q => q.messageId === messageId);
    if (index !== -1) queue.splice(index, 1);

    drop(messageId);
    rearm();
    refresh(entry);

    return true;
}

/** Jump a message to the front of the queue. */
export function deleteSoon(channelId: string, messageId: string, reason: string) {
    if (!running) return;

    const existing = pending.get(messageId);
    if (existing) {
        existing.deleteAt = 0;
        existing.reason = reason;
    } else {
        pending.set(messageId, {
            channelId,
            messageId,
            deleteAt: 0,
            createdAt: Date.now(),
            reason,
            attempts: 0
        });
    }

    persistSoon();
    tick();
}

export function retime(messageId: string, ttlSeconds: number): boolean {
    const entry = pending.get(messageId);
    if (!entry || inFlight.has(messageId)) return false;

    entry.deleteAt = Date.now() + Math.min(Math.max(ttlSeconds, MIN_TTL), MAX_TTL) * 1000;
    persistSoon();
    rearm();
    refresh(entry);

    return true;
}

/** Somebody else deleted it, or it vanished. Forget it silently. */
export function forget(messageId: string) {
    if (!pending.has(messageId)) return;

    const index = queue.findIndex(q => q.messageId === messageId);
    if (index !== -1) queue.splice(index, 1);

    drop(messageId);
    rearm();
}

export async function resume() {
    running = true;

    let saved: unknown;
    try {
        saved = await get(STORE_KEY);
    } catch (err) {
        logger.error("Could not read the pending queue", err);
        tick();
        return;
    }

    const now = Date.now();
    const maxAge = settings.store.maxQueueAgeDays * 86_400_000;
    let overdue = 0;
    let expired = 0;

    for (const entry of Array.isArray(saved) ? saved : []) {
        if (!isPlausible(entry)) continue;

        // Discord was shut when this came due, and by now you have probably moved on.
        // Deleting week-old messages in a burst is the behaviour this plugin exists to avoid.
        if (now - (entry.createdAt ?? entry.deleteAt) > maxAge) {
            expired++;
            continue;
        }

        entry.attempts = 0;
        entry.holds = 0;
        entry.firstTriedAt = undefined;
        pending.set(entry.messageId, entry);
        if (entry.deleteAt <= now) overdue++;
    }

    if (expired > 0) {
        logger.info(`Forgot ${expired} queued message(s) older than ${settings.store.maxQueueAgeDays}d`);
    }

    if (overdue > 0) {
        catchUpRemaining = overdue;
        showNotice(
            `AutoDelete: ${overdue} message${overdue === 1 ? "" : "s"} came due while Discord was closed. `
            + `Clearing them one every ${(CATCH_UP_INTERVAL_MS / 1000).toFixed(1)}s.`,
            "Got it",
            () => { }
        );
    }

    await persistNow();
    tick();
}

export async function shutdown() {
    running = false;

    if (wheel != null) {
        clearTimeout(wheel);
        wheel = null;
    }
    if (saveTimer != null) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }

    queue.length = 0;
    inFlight.clear();
    catchUpRemaining = 0;
    holdUntil = 0;
    lastRequestAt = 0;
    consecutiveFailures = 0;

    // The queue stays on disk: timers should survive a plugin toggle.
    await persistNow();
    pending.clear();
}
