/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Gaiiiaaa
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Constants, RestAPI, showToast, Toasts } from "@webpack/common";

import { DiscordMessage, DiscordSearchResponse, PurgeOptions, PurgeStats } from "./types";

/** Nombre de recherches vides consécutives tolérées avant d'abandonner (latence de l'index Discord). */
const MAX_EMPTY_RETRIES = 2;

export class PurgeEngine {
    private options: PurgeOptions;
    private onUpdate: (stats: PurgeStats) => void;
    private stopped = false;
    private paused = false;
    private pauseResolve: (() => void) | null = null;

    /**
     * Messages déjà traités : succès, 404, ou échec définitif.
     * Inclure les échecs est ce qui empêche la recherche de reboucler indéfiniment
     * sur un message qu'on ne peut pas supprimer (403, perte de permissions...).
     */
    private handledIds = new Set<string>();

    private stats: PurgeStats = {
        totalFound: 0,
        deletedCount: 0,
        failedCount: 0,
        isTotalKnown: false,
        isSearching: false,
        isDeleting: false,
        isPaused: false,
        isStopped: false,
        isDone: false,
        statusText: "Prêt",
    };

    constructor(options: PurgeOptions, onUpdate: (stats: PurgeStats) => void) {
        this.options = options;
        this.onUpdate = onUpdate;
    }

    public getStats(): PurgeStats {
        return { ...this.stats };
    }

    private updateStats(partial: Partial<PurgeStats>) {
        this.stats = { ...this.stats, ...partial };
        this.onUpdate(this.stats);
    }

    public pause() {
        if ((!this.stats.isDeleting && !this.stats.isSearching) || this.paused) return;
        this.paused = true;
        this.updateStats({ isPaused: true, statusText: "En pause" });
    }

    public resume() {
        if (!this.paused) return;
        this.paused = false;
        this.updateStats({ isPaused: false, statusText: "Reprise de l'exécution..." });
        if (this.pauseResolve) {
            this.pauseResolve();
            this.pauseResolve = null;
        }
    }

    public stop() {
        this.stopped = true;
        this.paused = false;
        if (this.pauseResolve) {
            this.pauseResolve();
            this.pauseResolve = null;
        }
        this.updateStats({
            isDeleting: false,
            isSearching: false,
            isStopped: true,
            isPaused: false,
            statusText: "Arrêt demandé par l'utilisateur."
        });
    }

    private async checkPauseOrStop(): Promise<boolean> {
        if (this.stopped) return true;
        if (this.paused) {
            await new Promise<void>(resolve => {
                this.pauseResolve = resolve;
            });
        }
        return this.stopped;
    }

    private async wait(ms: number): Promise<void> {
        const start = Date.now();
        while (Date.now() - start < ms) {
            if (this.stopped) break;
            await new Promise(r => setTimeout(r, 100));
        }
    }

    private async waitWithJitter(baseDelayMs: number, jitterMs: number): Promise<void> {
        const jitter = jitterMs > 0 ? (Math.random() * (jitterMs * 2) - jitterMs) : 0;
        const totalDelay = Math.max(600, baseDelayMs + jitter);
        await this.wait(totalDelay);
    }

    private extractRetryAfter(err: any): number {
        if (typeof err?.body?.retry_after === "number") {
            return err.body.retry_after;
        }
        if (typeof err?.response?.body?.retry_after === "number") {
            return err.response.body.retry_after;
        }
        const headerVal = err?.headers?.["retry-after"] || err?.response?.headers?.["retry-after"];
        if (headerVal) {
            const parsed = parseFloat(headerVal);
            if (!isNaN(parsed) && parsed > 0) return parsed;
        }
        return 2.5;
    }

    /** Aperçu affiché dans l'UI pour le message en cours de suppression. */
    private previewOf(msg: DiscordMessage) {
        return {
            id: msg.id,
            content: msg.content || (msg.attachments?.length ? "[Pièce jointe / Embed]" : "(Message vide)"),
            timestamp: msg.timestamp
        };
    }

    private async deleteSingleMessage(channelId: string, messageId: string): Promise<boolean> {
        const deleteUrl = Constants?.Endpoints?.MESSAGE?.(channelId, messageId) ?? `/channels/${channelId}/messages/${messageId}`;

        while (!this.stopped) {
            if (await this.checkPauseOrStop()) return false;

            try {
                await RestAPI.del({ url: deleteUrl });
                return true;
            } catch (err: any) {
                const status = err?.status ?? err?.response?.status;

                if (status === 429) {
                    const retryAfter = this.extractRetryAfter(err);
                    const waitTimeSec = Math.ceil(retryAfter) + 1;
                    this.updateStats({
                        statusText: `Rate limit détecté ! Pause automatique de ${waitTimeSec}s...`,
                        rateLimitWaitSeconds: waitTimeSec
                    });
                    await this.wait(waitTimeSec * 1000);
                    this.updateStats({
                        statusText: "Reprise après attente du rate limit...",
                        rateLimitWaitSeconds: undefined
                    });
                    continue; // réessaie le même message
                }

                // Le message n'existe plus : objectif atteint.
                if (status === 404) return true;

                if (status === 403) {
                    console.error("[PurgeMyMessages] 403 Forbidden sur le message:", messageId);
                    return false;
                }

                console.error("[PurgeMyMessages] Erreur inconnue lors de la suppression:", err);
                return false;
            }
        }
        return false;
    }

    /**
     * Supprime un message et met à jour les compteurs.
     * L'id est marqué comme traité dans tous les cas : un échec ne doit jamais
     * être re-proposé par la boucle de recherche.
     */
    private async processMessage(msg: DiscordMessage): Promise<void> {
        const channelId = msg.channel_id ?? this.options.channelId;
        const success = await this.deleteSingleMessage(channelId, msg.id);

        this.handledIds.add(msg.id);
        this.updateStats(success
            ? { deletedCount: this.stats.deletedCount + 1 }
            : { failedCount: this.stats.failedCount + 1 });
    }

    private reachedLimit(): boolean {
        return this.options.limit > 0 && this.stats.deletedCount >= this.options.limit;
    }

    public async start(): Promise<void> {
        this.stopped = false;
        this.paused = false;
        this.handledIds.clear();

        this.updateStats({
            totalFound: 0,
            deletedCount: 0,
            failedCount: 0,
            isTotalKnown: false,
            isSearching: true,
            isDeleting: false,
            isPaused: false,
            isStopped: false,
            isDone: false,
            statusText: "Initialisation de la recherche...",
            lastDeletedMessage: undefined,
            rateLimitWaitSeconds: undefined
        });

        try {
            if (this.options.mode === "search") {
                await this.runSearchMode();
            } else {
                await this.runHistoryMode();
            }
        } catch (err) {
            console.error("[PurgeMyMessages] Erreur fatale dans le moteur:", err);
            this.updateStats({
                statusText: "Une erreur est survenue lors de l'exécution."
            });
        } finally {
            const isAborted = this.stopped;
            this.updateStats({
                isSearching: false,
                isDeleting: false,
                isDone: !isAborted,
                isStopped: isAborted,
                rateLimitWaitSeconds: undefined,
                statusText: isAborted
                    ? "Purge arrêtée."
                    : `Terminé ! ${this.stats.deletedCount} message(s) supprimé(s).`
            });

            if (!isAborted) {
                showToast(
                    `Purge terminée : ${this.stats.deletedCount} message(s) supprimé(s) !`,
                    Toasts.Type.SUCCESS
                );
            }
        }
    }

    /**
     * Mode recherche : on interroge toujours l'offset 0 et on supprime ce qui remonte.
     * Les messages supprimés disparaissent de l'index, donc la page suivante arrive
     * naturellement à l'offset 0 — pas besoin de paginer.
     */
    private async runSearchMode(): Promise<void> {
        const { channelId, guildId, authorId, filterText, delayMs, jitterMs } = this.options;
        const searchUrl = guildId
            ? `/guilds/${guildId}/messages/search`
            : `/channels/${channelId}/messages/search`;

        let emptyRetries = 0;

        while (!this.stopped && !this.reachedLimit()) {
            if (await this.checkPauseOrStop()) break;

            this.updateStats({
                isSearching: true,
                isDeleting: false,
                statusText: "Recherche de messages..."
            });

            const searchRes = await this.fetchSearchPage(searchUrl, authorId, channelId, guildId, filterText);
            if (this.stopped || !searchRes) break;

            const batch = this.extractBatch(searchRes, authorId);

            this.updateStats({
                isTotalKnown: true,
                totalFound: Math.max(searchRes.total_results || 0, this.stats.deletedCount + batch.length)
            });

            if (batch.length === 0) {
                // L'index Discord peut avoir du retard : on retente un peu avant d'abandonner.
                if (++emptyRetries > MAX_EMPTY_RETRIES) break;
                this.updateStats({ statusText: "Aucun résultat, nouvelle vérification de l'index..." });
                await this.wait(2000);
                continue;
            }
            emptyRetries = 0;

            this.updateStats({ isSearching: false, isDeleting: true });

            for (const msg of batch) {
                if (await this.checkPauseOrStop()) break;
                if (this.reachedLimit()) break;

                const totalDisplay = this.options.limit > 0
                    ? Math.min(this.options.limit, this.stats.totalFound)
                    : this.stats.totalFound;

                this.updateStats({
                    statusText: `Suppression du message ${this.stats.deletedCount + 1} sur ${totalDisplay || "?"}...`,
                    lastDeletedMessage: this.previewOf(msg)
                });

                await this.processMessage(msg);
                await this.waitWithJitter(delayMs, jitterMs);
            }

            // Laisse l'index Discord se mettre à jour avant la page suivante.
            await this.wait(1200);
        }
    }

    /** Une page de recherche, en gérant 202 (index en cours de création) et 429. */
    private async fetchSearchPage(
        searchUrl: string,
        authorId: string,
        channelId: string,
        guildId: string | undefined,
        filterText: string | undefined
    ): Promise<DiscordSearchResponse | null> {
        const query: Record<string, any> = { author_id: authorId, offset: 0 };
        if (guildId) query.channel_id = channelId;
        if (filterText?.trim()) query.content = filterText.trim();

        while (!this.stopped) {
            if (await this.checkPauseOrStop()) return null;

            try {
                const res = await RestAPI.get({ url: searchUrl, query });

                if (res.status === 202) {
                    const waitSec = res.body?.retry_after ?? 5;
                    this.updateStats({
                        statusText: `Index Discord en création, attente de ${waitSec}s...`,
                        rateLimitWaitSeconds: waitSec
                    });
                    await this.wait(waitSec * 1000);
                    this.updateStats({ rateLimitWaitSeconds: undefined });
                    continue;
                }

                return res.body as DiscordSearchResponse;
            } catch (err: any) {
                const status = err?.status ?? err?.response?.status;
                if (status === 429) {
                    const waitTimeSec = Math.ceil(this.extractRetryAfter(err)) + 1;
                    this.updateStats({
                        statusText: `Rate limit de recherche ! Attente de ${waitTimeSec}s...`,
                        rateLimitWaitSeconds: waitTimeSec
                    });
                    await this.wait(waitTimeSec * 1000);
                    this.updateStats({ rateLimitWaitSeconds: undefined });
                    continue;
                }

                console.error("[PurgeMyMessages] Search error:", err);
                this.updateStats({ statusText: "Erreur lors de la recherche des messages." });
                return null;
            }
        }
        return null;
    }

    /** La recherche renvoie des groupes [avant, résultat, après] : on extrait le hit. */
    private extractBatch(searchRes: DiscordSearchResponse, authorId: string): DiscordMessage[] {
        const batch: DiscordMessage[] = [];

        for (const group of searchRes.messages ?? []) {
            const hit = Array.isArray(group)
                ? group.find(m => m.hit || m.author?.id === authorId) ?? group[0]
                : group as DiscordMessage;

            // Discord remonte aussi du contexte qui n'est pas de nous : on ne supprime que nos messages.
            if (hit?.id && hit.author?.id === authorId && !this.handledIds.has(hit.id)) {
                batch.push(hit);
            }
        }

        return batch;
    }

    /** Mode historique : pagination classique avec un curseur `before`. */
    private async runHistoryMode(): Promise<void> {
        const { channelId, authorId, filterText, delayMs, jitterMs } = this.options;
        const messagesUrl = Constants?.Endpoints?.MESSAGES?.(channelId) ?? `/channels/${channelId}/messages`;
        const needle = filterText?.trim().toLowerCase();

        let beforeId: string | undefined;

        this.updateStats({
            isSearching: false,
            isDeleting: true,
            isTotalKnown: false,
            statusText: "Balayage de l'historique du salon..."
        });

        while (!this.stopped && !this.reachedLimit()) {
            if (await this.checkPauseOrStop()) break;

            const rawList = await this.fetchHistoryPage(messagesUrl, beforeId);
            if (this.stopped || !rawList?.length) break;

            // Curseur vers le message le plus ancien du lot (les snowflakes restent
            // valides même une fois le message supprimé).
            beforeId = rawList[rawList.length - 1].id;

            const myMessages = rawList.filter(m =>
                m.author?.id === authorId
                && !this.handledIds.has(m.id)
                && (!needle || (m.content || "").toLowerCase().includes(needle)));

            this.updateStats({ totalFound: this.stats.totalFound + myMessages.length });

            for (const msg of myMessages) {
                if (await this.checkPauseOrStop()) break;
                if (this.reachedLimit()) break;

                this.updateStats({
                    statusText: `Suppression du message ${this.stats.deletedCount + 1}...`,
                    lastDeletedMessage: this.previewOf(msg)
                });

                await this.processMessage(msg);
                await this.waitWithJitter(delayMs, jitterMs);
            }
        }
    }

    private async fetchHistoryPage(messagesUrl: string, beforeId: string | undefined): Promise<DiscordMessage[] | null> {
        const query: Record<string, any> = { limit: 100 };
        if (beforeId) query.before = beforeId;

        while (!this.stopped) {
            if (await this.checkPauseOrStop()) return null;

            try {
                const res = await RestAPI.get({ url: messagesUrl, query });
                return (res.body as DiscordMessage[]) || [];
            } catch (err: any) {
                const status = err?.status ?? err?.response?.status;
                if (status === 429) {
                    const waitTimeSec = Math.ceil(this.extractRetryAfter(err)) + 1;
                    this.updateStats({
                        statusText: `Rate limit d'historique ! Attente de ${waitTimeSec}s...`,
                        rateLimitWaitSeconds: waitTimeSec
                    });
                    await this.wait(waitTimeSec * 1000);
                    this.updateStats({ rateLimitWaitSeconds: undefined });
                    continue;
                }

                console.error("[PurgeMyMessages] Erreur lecture historique:", err);
                return null;
            }
        }
        return null;
    }
}
