/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Gaiiiaaa
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { DeleteIcon, OpenExternalIcon } from "@components/Icons";
import { Span } from "@components/Span";
import { createRoot, useEffect, useState } from "@webpack/common";
import type { Root } from "react-dom/client";

import { purgeManager } from "./manager";
import { openPurgeModal } from "./PurgeModal";

export function FloatingPurgeWidget() {
    const [, setTick] = useState(0);

    useEffect(() => purgeManager.subscribe(() => setTick(t => t + 1)), []);

    const session = purgeManager.getSession();

    // Pas de session, ou la grande modale est déjà ouverte : rien à afficher.
    if (!session || purgeManager.isModalOpen()) return null;

    const { channel, stats } = session;
    const isRunning = stats.isSearching || stats.isDeleting;

    // Même règle que la modale : un pourcentage seulement si la cible est connue.
    const progressTarget = stats.isTotalKnown ? stats.totalFound : 0;
    const progressPercent = progressTarget > 0
        ? Math.min(100, Math.round((stats.deletedCount / progressTarget) * 100))
        : 0;

    const channelName = channel.name ? `#${channel.name}` : "ce salon";

    const accentColor = stats.rateLimitWaitSeconds
        ? "var(--status-warning, #faa81a)"
        : stats.isDone
            ? "var(--status-positive, #23a55a)"
            : "var(--status-danger, #ed4245)";

    return (
        <div
            style={{
                position: "fixed",
                bottom: "24px",
                right: "24px",
                zIndex: 9999,
                width: "340px",
                backgroundColor: "var(--background-secondary, #2b2d31)",
                border: "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.1))",
                borderRadius: "12px",
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45)",
                padding: "14px 16px",
                color: "var(--text-normal, #dbdee1)",
                fontFamily: "var(--font-primary, sans-serif)",
                display: "flex",
                flexDirection: "column",
                gap: "10px"
            }}
        >
            {/* Ligne d'en-tête */}
            <Flex alignItems="center" justifyContent="space-between">
                <Flex alignItems="center" gap={8}>
                    <DeleteIcon
                        width={18}
                        height={18}
                        style={{
                            color: stats.rateLimitWaitSeconds
                                ? "var(--status-warning, #faa81a)"
                                : "var(--status-danger, #ed4245)"
                        }}
                    />
                    <Span size="sm" weight="bold">
                        Purger : {channelName}
                    </Span>
                </Flex>

                <button
                    onClick={() => openPurgeModal(channel)}
                    title="Agrandir la fenêtre"
                    style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--interactive-normal, #b5bac1)",
                        padding: "2px",
                        display: "flex",
                        alignItems: "center"
                    }}
                >
                    <OpenExternalIcon width={16} height={16} />
                </button>
            </Flex>

            {/* Statut & Progression */}
            <Flex flexDirection="column" gap={4}>
                <Flex alignItems="center" justifyContent="space-between">
                    <Span
                        size="xs"
                        style={{
                            color: stats.rateLimitWaitSeconds || stats.isDone
                                ? accentColor
                                : "var(--text-muted, #949ba4)"
                        }}
                    >
                        {stats.statusText}
                    </Span>
                    {progressTarget > 0 && (
                        <Span size="xs" style={{ color: "var(--text-muted)" }}>
                            {progressPercent}%
                        </Span>
                    )}
                </Flex>

                {/* Barre de progression (uniquement si la cible est connue) */}
                {progressTarget > 0 && (
                    <div
                        style={{
                            width: "100%",
                            height: "6px",
                            backgroundColor: "var(--background-modifier-accent, rgba(255, 255, 255, 0.08))",
                            borderRadius: "4px",
                            overflow: "hidden"
                        }}
                    >
                        <div
                            style={{
                                width: `${progressPercent}%`,
                                height: "100%",
                                backgroundColor: accentColor,
                                transition: "width 0.25s ease"
                            }}
                        />
                    </div>
                )}

                <Flex alignItems="center" justifyContent="space-between" style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                    <span>Supprimés : {stats.deletedCount}{progressTarget > 0 ? ` / ${progressTarget}` : ""}</span>
                    {stats.failedCount > 0 && (
                        <span style={{ color: "var(--status-danger)" }}>Échecs : {stats.failedCount}</span>
                    )}
                </Flex>
            </Flex>

            {/* Boutons d'action */}
            <Flex alignItems="center" gap={8} style={{ marginTop: "2px" }}>
                {isRunning ? (
                    <>
                        <Button
                            size="small"
                            variant={stats.isPaused ? "positive" : "secondary"}
                            onClick={() => (stats.isPaused ? purgeManager.resume() : purgeManager.pause())}
                            style={{ flex: 1 }}
                        >
                            {stats.isPaused ? "Reprendre" : "Pause"}
                        </Button>
                        <Button
                            size="small"
                            variant="dangerSecondary"
                            onClick={() => purgeManager.stop()}
                            style={{ flex: 1 }}
                        >
                            Arrêter
                        </Button>
                    </>
                ) : (
                    <Button
                        size="small"
                        variant="secondary"
                        onClick={() => purgeManager.clearSession()}
                        style={{ flex: 1 }}
                    >
                        Fermer le widget
                    </Button>
                )}
            </Flex>
        </div>
    );
}

let reactRoot: Root | null = null;
let container: HTMLDivElement | null = null;

export function initFloatingWidget() {
    if (container) return;

    container = document.createElement("div");
    container.id = "vc-purge-floating-widget-root";
    document.body.appendChild(container);
    reactRoot = createRoot(container);
    reactRoot.render(
        <ErrorBoundary noop>
            <FloatingPurgeWidget />
        </ErrorBoundary>
    );
}

export function destroyFloatingWidget() {
    if (reactRoot) {
        reactRoot.unmount();
        reactRoot = null;
    }
    if (container) {
        container.remove();
        container = null;
    }
}
