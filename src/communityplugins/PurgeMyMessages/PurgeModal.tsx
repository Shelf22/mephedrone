/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Gaiiiaaa
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Divider } from "@components/Divider";
import { Flex } from "@components/Flex";
import { FormSwitch } from "@components/FormSwitch";
import { HeadingSecondary } from "@components/Heading";
import { DeleteIcon, InfoIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import { Span } from "@components/Span";
import { Channel, RenderModalProps } from "@vencord/discord-types";
import {
    GuildStore,
    Modal,
    openModal,
    Select,
    TextInput,
    useEffect,
    UserStore,
    useState } from "@webpack/common";

import { purgeManager } from "./manager";
import { PurgeOptions, PurgeStats } from "./types";

const IDLE_STATS: PurgeStats = {
    totalFound: 0,
    deletedCount: 0,
    failedCount: 0,
    isTotalKnown: false,
    isSearching: false,
    isDeleting: false,
    isPaused: false,
    isStopped: false,
    isDone: false,
    statusText: "Prêt à démarrer.",
};

export function openPurgeModal(channel: Channel) {
    openModal(modalProps => (
        <PurgeModal channel={channel} modalProps={modalProps} />
    ));
}

export function PurgeModal({ channel, modalProps }: { channel: Channel; modalProps: RenderModalProps; }) {
    const currentUser = UserStore.getCurrentUser();
    const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id) : null;

    // Options de configuration
    const [mode, setMode] = useState<"search" | "history">("search");
    const [delayMs, setDelayMs] = useState<number>(1500);
    const [useJitter, setUseJitter] = useState<boolean>(true);
    const [limitStr, setLimitStr] = useState<string>("50");
    const [filterText, setFilterText] = useState<string>("");

    // Garde-fou : « tout supprimer » demande un second clic.
    const [confirmingPurgeAll, setConfirmingPurgeAll] = useState(false);

    // Synchronisation avec PurgeManager
    const [, setTick] = useState(0);

    useEffect(() => {
        purgeManager.setModalOpen(true);

        const unsubscribe = purgeManager.subscribe(() => {
            setTick(t => t + 1);
        });

        return () => {
            purgeManager.setModalOpen(false);
            unsubscribe();
        };
    }, []);

    const session = purgeManager.getSession();
    const isTargetChannel = session?.channel.id === channel.id;
    const isOtherChannelBusy = Boolean(session) && !isTargetChannel;

    // Scoper au salon affiché : sinon les boutons Pause/Arrêter de cette modale
    // piloteraient une purge lancée sur un autre salon.
    const isRunning = isTargetChannel && purgeManager.isRunning();

    const stats: PurgeStats = (session && isTargetChannel)
        ? session.stats
        : {
            ...IDLE_STATS,
            statusText: isOtherChannelBusy
                ? `Une suppression est déjà en cours sur un autre salon (#${session!.channel.name || session!.channel.id}).`
                : IDLE_STATS.statusText,
        };

    const canChangeSettings = !isRunning && !stats.isPaused;
    const limitNum = Math.max(0, parseInt(limitStr.trim(), 10) || 0);

    const handleStart = async () => {
        if (!currentUser?.id) return;

        if (limitNum === 0 && !confirmingPurgeAll) {
            setConfirmingPurgeAll(true);
            return;
        }
        setConfirmingPurgeAll(false);

        const options: PurgeOptions = {
            channelId: channel.id,
            guildId: channel.guild_id,
            authorId: currentUser.id,
            delayMs,
            jitterMs: useJitter ? 250 : 0,
            limit: limitNum,
            filterText: filterText.trim() || undefined,
            mode
        };

        await purgeManager.start(channel, options);
    };

    const handlePauseToggle = () => {
        if (stats.isPaused) {
            purgeManager.resume();
        } else {
            purgeManager.pause();
        }
    };

    const channelName = channel.name
        ? `#${channel.name}`
        : channel.rawRecipients?.length
            ? `DM avec ${channel.rawRecipients.map(u => u.username).join(", ")}`
            : `Salon (${channel.id})`;

    // Un pourcentage n'a de sens que si on connaît la cible : total_results en mode
    // recherche, ou la limite demandée. En balayage d'historique sans limite, on
    // découvre les messages au fil de l'eau — on affiche un simple compteur.
    const progressTarget = stats.isTotalKnown && stats.totalFound > 0
        ? (limitNum > 0 ? Math.min(limitNum, stats.totalFound) : stats.totalFound)
        : limitNum;

    const progressPercent = progressTarget > 0
        ? Math.min(100, Math.round((stats.deletedCount / progressTarget) * 100))
        : 0;

    const delayOptions = [
        { label: "1.5s (Recommandé - Sûr & Stable)", value: 1500 },
        { label: "2.0s (Très prudent)", value: 2000 },
        { label: "3.0s (Sécurité maximale)", value: 3000 },
        { label: "1.2s (Rapide)", value: 1200 },
        { label: "1.0s (Rapide - Attention au Rate Limit)", value: 1000 },
    ];

    const modeOptions = [
        { label: "Recherche Discord (Rapide - Cible directement vos messages)", value: "search" },
        { label: "Balayage d'historique (Méthodique - Utile si recherche indisponible)", value: "history" },
    ];

    let cardVariant: "normal" | "warning" | "danger" | "info" | "success" = "normal";
    if (stats.rateLimitWaitSeconds) cardVariant = "warning";
    else if (stats.isDone) cardVariant = "success";
    else if (stats.isDeleting) cardVariant = "danger";
    else if (stats.isSearching) cardVariant = "info";

    return (
        <Modal
            {...modalProps}
            title="Supprimer mes messages"
            subtitle={`${channelName}${guild ? ` • Serveur : ${guild.name}` : ""}`}
            size="large"
            actions={[
                {
                    text: isRunning ? "Poursuivre en tâche de fond (Fermer la vue)" : "Fermer",
                    variant: "secondary",
                    onClick: modalProps.onClose
                }
            ]}
        >
            <Flex flexDirection="column" gap={16} style={{ padding: "8px 0" }}>
                {/* Carte de statut / progression */}
                <Card variant={cardVariant}>
                    <Flex flexDirection="column" gap={8}>
                        <Flex alignItems="center" justifyContent="space-between">
                            <Span size="md" weight="bold">
                                {stats.statusText}
                            </Span>
                            {isRunning && progressTarget > 0 && (
                                <Span size="sm" style={{ color: "var(--text-muted)" }}>
                                    {progressPercent}%
                                </Span>
                            )}
                        </Flex>

                        {/* Barre de progression (uniquement si la cible est connue) */}
                        {progressTarget > 0 && (
                            <div
                                style={{
                                    width: "100%",
                                    backgroundColor: "var(--background-modifier-accent, #3a3c42)",
                                    borderRadius: "8px",
                                    height: "10px",
                                    overflow: "hidden",
                                    marginTop: "4px"
                                }}
                            >
                                <div
                                    style={{
                                        width: `${progressPercent}%`,
                                        backgroundColor: stats.rateLimitWaitSeconds
                                            ? "var(--status-warning, #faa81a)"
                                            : stats.isDone
                                                ? "var(--status-positive, #23a55a)"
                                                : "var(--status-danger, #ed4245)",
                                        height: "100%",
                                        transition: "width 0.25s ease"
                                    }}
                                />
                            </div>
                        )}

                        {/* Compteurs */}
                        <Flex alignItems="center" gap={16} style={{ marginTop: "4px" }}>
                            <Span size="sm">
                                <b>Trouvés :</b> {stats.totalFound}{stats.isTotalKnown ? "" : "+"}
                            </Span>
                            <Span size="sm">
                                <b>Supprimés :</b> {stats.deletedCount}
                            </Span>
                            {stats.failedCount > 0 && (
                                <Span size="sm" style={{ color: "var(--status-danger, #ed4245)" }}>
                                    <b>Échecs :</b> {stats.failedCount}
                                </Span>
                            )}
                        </Flex>

                        {/* Dernier message supprimé */}
                        {stats.lastDeletedMessage && (
                            <Paragraph style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic", marginTop: "2px" }}>
                                Dernier message : {stats.lastDeletedMessage.content.slice(0, 70)}
                                {stats.lastDeletedMessage.content.length > 70 ? "..." : ""}
                            </Paragraph>
                        )}
                    </Flex>
                </Card>

                {/* Contrôles d'exécution */}
                <Flex alignItems="center" gap={12}>
                    {!isRunning && !stats.isPaused && (
                        <Button
                            variant="dangerPrimary"
                            onClick={handleStart}
                            disabled={!currentUser?.id || isOtherChannelBusy}
                        >
                            <Flex alignItems="center" gap={8}>
                                <DeleteIcon width={16} height={16} />
                                <span>
                                    {confirmingPurgeAll
                                        ? "Confirmer : supprimer TOUS mes messages"
                                        : stats.isDone
                                            ? "Relancer la purge"
                                            : "Démarrer la suppression"}
                                </span>
                            </Flex>
                        </Button>
                    )}

                    {(isRunning || stats.isPaused) && (
                        <>
                            <Button
                                variant={stats.isPaused ? "positive" : "secondary"}
                                onClick={handlePauseToggle}
                            >
                                {stats.isPaused ? "Reprendre" : "Pause"}
                            </Button>
                            <Button
                                variant="dangerSecondary"
                                onClick={() => purgeManager.stop()}
                            >
                                Arrêter
                            </Button>
                        </>
                    )}
                </Flex>

                <Divider />

                {/* Section Paramètres */}
                <Flex flexDirection="column" gap={12} style={{ opacity: canChangeSettings ? 1 : 0.6 }}>
                    <HeadingSecondary>Paramètres de la purge</HeadingSecondary>

                    {/* Mode de recherche */}
                    <div>
                        <Span size="sm" weight="medium" style={{ display: "block", marginBottom: "4px" }}>
                            Mode de détection :
                        </Span>
                        <Select
                            options={modeOptions}
                            isSelected={v => v === mode}
                            select={v => canChangeSettings && setMode(v as any)}
                            serialize={String}
                            isDisabled={!canChangeSettings}
                        />
                    </div>

                    {/* Délai entre suppressions */}
                    <div>
                        <Span size="sm" weight="medium" style={{ display: "block", marginBottom: "4px" }}>
                            Délai entre chaque message :
                        </Span>
                        <Select
                            options={delayOptions}
                            isSelected={v => v === delayMs}
                            select={v => canChangeSettings && setDelayMs(v as any)}
                            serialize={String}
                            isDisabled={!canChangeSettings}
                        />
                    </div>

                    {/* Jitter aléatoire */}
                    <FormSwitch
                        title="Variation aléatoire naturelle (±250 ms)"
                        description="Ajoute une micro-fluctuation pour éviter un rythme d'envoi parfaitement régulier."
                        value={useJitter}
                        onChange={v => canChangeSettings && setUseJitter(v)}
                        disabled={!canChangeSettings}
                    />

                    {/* Limite de messages */}
                    <div>
                        <Span size="sm" weight="medium" style={{ display: "block", marginBottom: "4px" }}>
                            Limite de messages (0 = Tout supprimer) :
                        </Span>
                        <TextInput
                            value={limitStr}
                            onChange={v => {
                                if (!canChangeSettings) return;
                                setConfirmingPurgeAll(false);
                                setLimitStr(v);
                            }}
                            placeholder="Ex: 50 ou 0 pour tous"
                            disabled={!canChangeSettings}
                        />
                    </div>

                    {/* Filtre textuel */}
                    <div>
                        <Span size="sm" weight="medium" style={{ display: "block", marginBottom: "4px" }}>
                            Filtre de texte (optionnel) :
                        </Span>
                        <TextInput
                            value={filterText}
                            onChange={v => canChangeSettings && setFilterText(v)}
                            placeholder="Supprimer uniquement les messages contenant ce mot..."
                            disabled={!canChangeSettings}
                        />
                    </div>
                </Flex>

                {/* Note d'information de sécurité */}
                <Flex alignItems="flex-start" gap={8} style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "4px" }}>
                    <InfoIcon width={16} height={16} style={{ flexShrink: 0, marginTop: "2px" }} />
                    <Paragraph>
                        <b>Exécution en arrière-plan activée :</b> Vous pouvez fermer cette fenêtre à tout moment. Un mini-panneau de contrôle apparaîtra en bas à droite de Discord pour suivre la suppression et l'arrêter quand vous voulez. La suppression est définitive.
                    </Paragraph>
                </Flex>
            </Flex>
        </Modal>
    );
}
