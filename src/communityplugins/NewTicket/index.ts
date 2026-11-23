/* eslint-disable simple-header/header */
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelActions, ChannelRouter, ChannelStore, GuildStore, MessageActions, NavigationRouter } from "@webpack/common";

const settings = definePluginSettings({
    guildId: {
        type: OptionType.STRING,
        displayName: "Server ID",
        description: "Target Server (Guild) ID to monitor. Leave empty to monitor all servers.",
        placeholder: "e.g. 1322568967801274418",
        default: "",
    },
    categoryId: {
        type: OptionType.STRING,
        displayName: "Ticket Category ID",
        description: "Target Category ID where ticket channels are created.",
        placeholder: "e.g. 1382768424609910965",
        default: "",
    }
});

let isEnabled = true;
const processedChannels = new Map<string, number>();
const activeTimeouts = new Set<ReturnType<typeof setTimeout>>();

function safeSetTimeout(fn: () => void, delay: number) {
    const timer = setTimeout(() => {
        activeTimeouts.delete(timer);
        if (!isEnabled) return;
        fn();
    }, delay);
    activeTimeouts.add(timer);
    return timer;
}

function clearAllTimeouts() {
    for (const timer of activeTimeouts) {
        clearTimeout(timer);
    }
    activeTimeouts.clear();
}

function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "F3") {
        e.preventDefault();
        isEnabled = !isEnabled;
        if (!isEnabled) {
            clearAllTimeouts();
        }
        showNotification({
            title: isEnabled ? "NewTicket Enabled" : "NewTicket Disabled",
            body: isEnabled
                ? "Ticket tracking system activated (F3)."
                : "Ticket tracking system deactivated (F3).",
            icon: "https://discord.com/assets/favicon.ico"
        });
    }
}

function cleanOldEntries() {
    const now = Date.now();
    for (const [id, ts] of processedChannels.entries()) {
        if (now - ts > 60_000) processedChannels.delete(id);
    }
}

function navigateToChannel(channelId: string, guildId: string) {
    if (!isEnabled) return;
    const effectiveGuild = (guildId && guildId !== "@me") ? guildId : (ChannelStore.getChannel(channelId)?.guild_id ?? "@me");

    const tryNavigate = () => {
        if (!isEnabled) return;
        try {
            NavigationRouter.transitionTo(`/channels/${effectiveGuild}/${channelId}`);
        } catch { /* ignore */ }

        try {
            ChannelRouter.transitionToChannel(channelId);
        } catch { /* ignore */ }

        try {
            if (ChannelActions?.selectChannel) {
                ChannelActions.selectChannel({ guildId: effectiveGuild, channelId });
            }
        } catch { /* ignore */ }
    };

    // 1. Immediate navigation attempt
    tryNavigate();

    // 2. Retry progressively until Discord resolves route / cache
    const delays = [50, 150, 350, 700, 1200];
    for (const delay of delays) {
        safeSetTimeout(tryNavigate, delay);
    }
}

function handleNewTicket(channelId: string, channelName: string, targetGuildId: string) {
    if (!isEnabled) return;

    let guildName = "Server";
    try {
        const guild = GuildStore?.getGuild(targetGuildId);
        if (guild?.name) guildName = guild.name;
    } catch { /* ignore */ }

    // 1. Navigate to channel
    navigateToChannel(channelId, targetGuildId);

    // 2. Pre-fetch messages
    try {
        MessageActions?.fetchMessages?.({ channelId });
    } catch { /* ignore */ }

    // 3. Send notification
    showNotification({
        title: "New Ticket Opened",
        body: `${guildName} · #${channelName}`,
        icon: "https://discord.com/assets/favicon.ico",
        onClick() {
            navigateToChannel(channelId, targetGuildId);
        }
    });
}

function checkAndProcessChannel(e: any) {
    if (!isEnabled || !e) return;

    const ch = e.channel ?? e;
    const channelId: string = String(ch?.id ?? e?.channelId ?? e?.id ?? "");
    if (!channelId) return;

    const configuredGuildId = settings.store.guildId?.trim() || "";
    const configuredCategoryId = settings.store.categoryId?.trim() || "";

    // If both server ID and category ID are empty, do nothing
    if (!configuredGuildId && !configuredCategoryId) {
        return;
    }

    // Detect server ID from event and store
    const storedCh: any = ChannelStore.getChannel(channelId);
    const detectedGuildId: string = String(
        ch?.guild_id ??
        ch?.guildId ??
        e?.guildId ??
        e?.guild_id ??
        storedCh?.guild_id ??
        storedCh?.guildId ??
        ""
    );

    // Server filter: Skip if configured server ID doesn't match
    if (configuredGuildId && (!detectedGuildId || detectedGuildId !== configuredGuildId)) {
        return;
    }

    cleanOldEntries();
    if (processedChannels.has(channelId)) return;

    const effectiveGuildId = detectedGuildId || configuredGuildId;

    // Detect category ID from event and store
    const parentId: string = String(
        ch?.parent_id ??
        ch?.parentId ??
        ch?.parentChannelId ??
        e?.parent_id ??
        e?.parentId ??
        storedCh?.parent_id ??
        storedCh?.parentId ??
        ""
    );

    // Category filter
    if (configuredCategoryId) {
        if (parentId === configuredCategoryId) {
            processedChannels.set(channelId, Date.now());
            const fetchedCh: any = ChannelStore.getChannel(channelId);
            const channelName = ch?.name ?? fetchedCh?.name ?? "ticket-channel";
            handleNewTicket(channelId, channelName, effectiveGuildId);
            return;
        }

        // Fallback polling for ticket bots that assign categories with slight delay
        const delays = [100, 300, 600, 1000, 1800, 3000];
        for (const delay of delays) {
            safeSetTimeout(() => {
                if (!isEnabled) return;
                if (processedChannels.has(channelId)) return;
                const updatedCh: any = ChannelStore.getChannel(channelId);
                if (!updatedCh) return;

                const updatedParent = String(updatedCh?.parent_id ?? updatedCh?.parentId ?? "");
                const updatedGuild = String(updatedCh?.guild_id ?? updatedCh?.guildId ?? effectiveGuildId);

                if (configuredGuildId && updatedGuild !== configuredGuildId) return;

                if (updatedParent === configuredCategoryId) {
                    processedChannels.set(channelId, Date.now());
                    handleNewTicket(channelId, updatedCh?.name ?? "ticket-channel", updatedGuild);
                }
            }, delay);
        }
    } else {
        // If category ID not set but server matches, handle the new channel
        processedChannels.set(channelId, Date.now());
        const fetchedCh: any = ChannelStore.getChannel(channelId);
        const channelName = ch?.name ?? fetchedCh?.name ?? "new-channel";
        handleNewTicket(channelId, channelName, effectiveGuildId);
    }
}

export default definePlugin({
    name: "NewTicket",
    description: "Instantly switches to newly opened ticket channels and displays desktop notifications.",
    authors: [{ name: "ViqoleBoneless", id: 0n }],
    settings,

    start() {
        document.addEventListener("keydown", handleKeyDown);
    },

    stop() {
        clearAllTimeouts();
        document.removeEventListener("keydown", handleKeyDown);
    },

    flux: {
        CHANNEL_CREATE(e: any) {
            checkAndProcessChannel(e);
        },
        CHANNEL_UPDATE(e: any) {
            checkAndProcessChannel(e);
        }
    }
});
