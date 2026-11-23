/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Gaiiiaaa
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Channel } from "@vencord/discord-types";

import { PurgeEngine } from "./engine";
import { PurgeOptions, PurgeStats } from "./types";

export interface ActivePurgeSession {
    engine: PurgeEngine;
    channel: Channel;
    stats: PurgeStats;
}

class PurgeManager {
    private session: ActivePurgeSession | null = null;
    private openModals = 0;
    private listeners = new Set<() => void>();

    public subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notify() {
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (err) {
                console.error("[PurgeMyMessages] Erreur listener:", err);
            }
        }
    }

    public getSession(): ActivePurgeSession | null {
        return this.session;
    }

    public isModalOpen(): boolean {
        return this.openModals > 0;
    }

    /** Compteur plutôt qu'un booléen : plusieurs modales peuvent être empilées. */
    public setModalOpen(open: boolean) {
        this.openModals = Math.max(0, this.openModals + (open ? 1 : -1));
        this.notify();
    }

    public isRunning(): boolean {
        return Boolean(this.session && (this.session.stats.isDeleting || this.session.stats.isSearching));
    }

    public async start(channel: Channel, options: PurgeOptions): Promise<void> {
        if (this.isRunning()) {
            console.warn("[PurgeMyMessages] Une purge est déjà en cours !");
            return;
        }

        const engine = new PurgeEngine(options, newStats => {
            // Un moteur arrêté peut encore émettre après qu'une nouvelle session
            // ait démarré : sans ce garde, il écrase les stats de la nouvelle.
            if (this.session?.engine !== engine) return;
            this.session.stats = newStats;
            this.notify();
        });

        this.session = {
            engine,
            channel,
            stats: engine.getStats()
        };

        this.notify();

        await engine.start();
    }

    public pause() {
        this.session?.engine.pause();
    }

    public resume() {
        this.session?.engine.resume();
    }

    public stop() {
        this.session?.engine.stop();
    }

    public clearSession() {
        if (this.session && !this.isRunning()) {
            this.session = null;
            this.notify();
        }
    }
}

export const purgeManager = new PurgeManager();
