/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 KernelSpecter
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { ClockIcon, DeleteIcon } from "@components/Icons";
import definePlugin from "@utils/types";
import { Channel, Message } from "@vencord/discord-types";
import { MessageFlags } from "@vencord/discord-types/enums";
import { ChannelStore, Menu, showToast, Toasts, UserStore } from "@webpack/common";

import { expandTrigger, getMessage, repliedTo } from "./chain";
import { About } from "./components/About";
import { Countdown } from "./components/Countdown";
import { formatCountdown, formatDuration, MIN_TTL, parseDuration } from "./duration";
import { defaultTtl, exemption, resolveTtl, resolveTtlForChannelId, setRule, Ttl } from "./rules";
import * as scheduler from "./scheduler";
import { settings } from "./settings";
import managedStyle from "./styles.css?managed";

/** Offered in the context menus. Anything else goes through /autodelete here. */
const PRESETS = [60, 300, 900, 3600, 21_600, 86_400];

function selfId() {
    return UserStore.getCurrentUser()?.id;
}

/** A channel is governed when a timer resolves to a positive number there. 0 means "off here". */
function governedTtl(channelId: string): number | null {
    const { ttl } = resolveTtlForChannelId(channelId);
    return ttl != null && ttl > 0 ? ttl : null;
}

function isReal(message: Message) {
    // Clyde replies injected by sendBotMessage carry a negative id and do not exist server side.
    if (!message.id || message.id.startsWith("-")) return false;
    if (message.state && message.state !== "SENT") return false;
    if (((message.flags ?? 0) & MessageFlags.EPHEMERAL) !== 0) return false;
    return true;
}

function armOwnMessage(message: Message) {
    if (!settings.store.armed) return;
    if (!isReal(message)) return;

    const ttl = governedTtl(message.channel_id);
    if (ttl == null) return;

    if (exemption(message)) return;

    scheduler.schedule(message.channel_id, message.id, ttl, "timer");
}

function onSomeoneReplied(message: Message, me: string) {
    const rootId = repliedTo(message);
    if (!rootId) return;

    const root = getMessage(message.channel_id, rootId);
    if (root?.author?.id !== me) return;
    if (governedTtl(message.channel_id) == null) return;

    const mode = settings.store.chainMode ?? "burst";

    for (const target of expandTrigger(mode, message.channel_id, rootId, me)) {
        if (!isReal(target) || exemption(target)) continue;
        scheduler.deleteSoon(target.channel_id, target.id, "reply");
    }
}

/** Reactions left by anybody but you. */
function foreignReactions(message: Message) {
    let total = 0;
    for (const reaction of message.reactions ?? []) {
        total += Math.max(0, reaction.count - (reaction.me ? 1 : 0));
    }
    return total;
}

// ---------------------------------------------------------------- context menus

function durationItems(idPrefix: string, onPick: (seconds: number) => void) {
    return PRESETS.map(seconds => (
        <Menu.MenuItem
            key={`${idPrefix}-${seconds}`}
            id={`${idPrefix}-${seconds}`}
            label={formatDuration(seconds)}
            action={() => onPick(seconds)}
        />
    ));
}

const messageMenuPatch: NavContextMenuPatchCallback = (children, props: { message?: Message; channel?: Channel; }) => {
    const { message } = props;
    if (!message || message.author?.id !== selfId() || !isReal(message)) return;

    const entry = scheduler.getPending(message.id);

    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuItem
            id="vc-autodelete"
            label="Auto-delete"
        >
            {entry && (
                <Menu.MenuItem
                    id="vc-autodelete-keep"
                    label={`Keep it (${formatCountdown(entry.deleteAt - Date.now())} left)`}
                    action={() => {
                        scheduler.keep(message.id);
                        showToast("AutoDelete will leave this one alone", Toasts.Type.SUCCESS);
                    }}
                />
            )}
            <Menu.MenuItem
                id="vc-autodelete-now"
                label="Delete now"
                color="danger"
                action={() => scheduler.deleteSoon(message.channel_id, message.id, "manual")}
            />
            <Menu.MenuSeparator />
            <Menu.MenuItem id="vc-autodelete-in" label={entry ? "Reschedule for" : "Delete in"}>
                {durationItems("vc-autodelete-in", seconds => {
                    if (scheduler.retime(message.id, seconds)) return;
                    scheduler.schedule(message.channel_id, message.id, seconds, "manual");
                })}
            </Menu.MenuItem>
        </Menu.MenuItem>
    );
};

function scopeMenu(id: string, label: string, targetId: string, current: Ttl, source: string) {
    return (
        <Menu.MenuItem id={id} label={label}>
            <Menu.MenuItem
                id={`${id}-current`}
                label={
                    current == null ? "No timer here"
                        : current === 0 ? "Off here"
                            : `Now: ${formatDuration(current)}${source === "channel" || source === "guild" ? "" : ` (${source})`}`
                }
                disabled
            />
            <Menu.MenuSeparator />
            {durationItems(id, seconds => {
                setRule(targetId, seconds);
                showToast(`Your messages here now last ${formatDuration(seconds)}`, Toasts.Type.SUCCESS);
            })}
            <Menu.MenuSeparator />
            <Menu.MenuItem
                id={`${id}-off`}
                label="Off here"
                action={() => {
                    setRule(targetId, 0);
                    showToast("AutoDelete will skip this place", Toasts.Type.SUCCESS);
                }}
            />
            <Menu.MenuItem
                id={`${id}-clear`}
                label="Clear rule"
                action={() => {
                    setRule(targetId, null);
                    showToast("Rule cleared", Toasts.Type.MESSAGE);
                }}
            />
        </Menu.MenuItem>
    );
}

const channelMenuPatch: NavContextMenuPatchCallback = (children, props: { channel?: Channel; }) => {
    const channel = props?.channel;
    if (!channel?.id) return;

    const { ttl, source } = resolveTtl(channel);

    children.push(
        <Menu.MenuSeparator />,
        scopeMenu("vc-autodelete-channel", "Auto-delete here", channel.id, ttl, source)
    );
};

const guildMenuPatch: NavContextMenuPatchCallback = (children, props: { guild?: { id: string; }; }) => {
    const guildId = props?.guild?.id;
    if (!guildId) return;

    const rules = settings.store.rules ?? {};
    const current = typeof rules[guildId] === "number" ? rules[guildId] : null;

    children.push(
        <Menu.MenuSeparator />,
        scopeMenu("vc-autodelete-guild", "Auto-delete in this server", guildId, current, "guild")
    );
};

// ---------------------------------------------------------------- commands

function describeHere(channelId: string) {
    const { ttl, source } = resolveTtlForChannelId(channelId);

    if (ttl == null) {
        return settings.store.scope === "listed"
            ? "No timer here. The scope is set to *only where I set a rule*, so nothing is scheduled until you set one."
            : "No timer here. This channel is outside the current scope.";
    }
    if (ttl === 0) return "Turned off here by an explicit rule.";

    return `Messages last **${formatDuration(ttl)}** here (from the ${source} rule).`;
}

export default definePlugin({
    name: "AutoDelete",
    description: "Puts a timer on the messages you send: they clean themselves up after a delay you set per channel, per category or per server, with a live countdown and a keep button.",
    tags: ["Chat", "Privacy", "Utility"],
    authors: [{ name: "KernelSpecter", id: 0n }],
    dependencies: ["CommandsAPI", "MessageAccessoriesAPI", "MessagePopoverAPI", "MessageUpdaterAPI"],

    settings,
    settingsAboutComponent: About,
    managedStyle,

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: Message; optimistic?: boolean; }) {
            // The optimistic copy carries a client-side nonce for an id. Deleting that is a no-op.
            if (optimistic || !message) return;

            const me = selfId();
            if (!me) return;

            if (message.author?.id === me) {
                armOwnMessage(message);
                return;
            }

            if (settings.store.armed && settings.store.deleteOnReply) onSomeoneReplied(message, me);
        },

        MESSAGE_REACTION_ADD(event: { channelId: string; messageId: string; userId: string; }) {
            if (!settings.store.armed || !settings.store.deleteOnReaction) return;

            const me = selfId();
            if (!me || !event?.messageId || event.userId === me) return;

            const message = getMessage(event.channelId, event.messageId);
            if (message?.author?.id !== me || !isReal(message)) return;
            if (governedTtl(event.channelId) == null) return;
            if (exemption(message)) return;

            // The store may not have counted this reaction yet, but we just watched it
            // arrive from somebody else, so it is worth at least one.
            if (Math.max(foreignReactions(message), 1) < settings.store.reactionThreshold) return;

            scheduler.deleteSoon(event.channelId, event.messageId, "reaction");
        },

        MESSAGE_DELETE({ id }: { id: string; }) {
            if (id) scheduler.forget(id);
        },

        MESSAGE_DELETE_BULK({ ids }: { ids?: string[]; }) {
            for (const id of ids ?? []) scheduler.forget(id);
        },

        MESSAGE_UPDATE({ message }: { message?: Message; }) {
            // An edit can only ever win a message a reprieve. It never arms one:
            // MESSAGE_UPDATE also fires when an embed resolves, and that must not
            // undo a Keep you clicked on purpose.
            if (!message?.id || !scheduler.getPending(message.id)) return;
            if (exemption(message)) scheduler.keep(message.id);
        }
    },

    contextMenus: {
        "message": messageMenuPatch,
        "channel-context": channelMenuPatch,
        "thread-context": channelMenuPatch,
        "gdm-context": channelMenuPatch,
        "guild-context": guildMenuPatch
    },

    messagePopoverButton: {
        icon: ClockIcon,
        render(message) {
            if (message.author?.id !== selfId() || !isReal(message)) return null;

            const channel = ChannelStore.getChannel(message.channel_id);
            const entry = scheduler.getPending(message.id);

            if (entry) {
                return {
                    label: `Keep (${formatCountdown(entry.deleteAt - Date.now())} left)`,
                    icon: ClockIcon,
                    message,
                    channel,
                    onClick: () => {
                        scheduler.keep(message.id);
                        showToast("AutoDelete will leave this one alone", Toasts.Type.SUCCESS);
                    }
                };
            }

            const ttl = resolveTtl(channel).ttl || defaultTtl();
            if (ttl == null || ttl < MIN_TTL) return null;

            return {
                label: `Auto-delete in ${formatDuration(ttl)}`,
                icon: DeleteIcon,
                message,
                channel,
                onClick: () => {
                    scheduler.schedule(message.channel_id, message.id, ttl, "manual");
                    showToast(`Set to delete in ${formatDuration(ttl)}`, Toasts.Type.SUCCESS);
                }
            };
        }
    },

    renderMessageAccessory(props: Record<string, any>) {
        const message = props.message as Message | undefined;

        if (!settings.store.showCountdown || !message?.id) return null;
        if (!scheduler.getPending(message.id)) return null;

        return <Countdown messageId={message.id} />;
    },

    toolboxActions: {
        "AutoDelete: arm / disarm"() {
            settings.store.armed = !settings.store.armed;
            showToast(
                settings.store.armed ? "AutoDelete is armed" : "AutoDelete is disarmed, nothing new will be scheduled",
                settings.store.armed ? Toasts.Type.SUCCESS : Toasts.Type.MESSAGE
            );
        },
        "AutoDelete: keep everything pending"() {
            const entries = scheduler.pendingEntries();
            for (const entry of entries) scheduler.keep(entry.messageId);
            showToast(`Cancelled ${entries.length} pending deletion${entries.length === 1 ? "" : "s"}`, Toasts.Type.SUCCESS);
        }
    },

    commands: [
        {
            name: "autodelete",
            description: "Show what AutoDelete is doing here",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute(_, ctx) {
                const pending = scheduler.pendingCount();
                const { armed, deleted, failed, skipped, rateLimited, lastError, lastCode } = scheduler.stats;

                const lines = [
                    settings.store.armed ? "**Armed.**" : "**Disarmed.** Nothing new is being scheduled.",
                    describeHere(ctx.channel.id),
                    `Pending: **${pending}** · armed this session: **${armed}** · deleted: **${deleted}** · left alone: **${skipped}** · failed: **${failed}**`
                ];

                // Armed far below the number you actually sent means the arming missed them,
                // which is a different fault from a delete that was refused.
                if (rateLimited > 0) lines.push(`Waited out a rate limit **${rateLimited}** time${rateLimited === 1 ? "" : "s"}.`);

                if (settings.store.dryRun) lines.push("Dry run is on, so nothing is actually being deleted.");
                if (scheduler.isCatchingUp()) lines.push("Currently working through a backlog from while Discord was closed.");
                if (lastError) lines.push(`Last error: \`${lastCode != null ? lastCode + " " : ""}${lastError}\``);

                sendBotMessage(ctx.channel.id, { content: lines.join("\n") });
            }
        },
        {
            name: "autodelete here",
            description: "Set how long your messages last in this channel",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{
                name: "timer",
                description: "A duration like 45s, 10m or 2h. Use 'off' to skip this channel, or 'clear' to remove the rule",
                type: ApplicationCommandOptionType.STRING,
                required: true
            }],
            execute(args, ctx) {
                const raw = findOption<string>(args, "timer", "").trim();
                const channelId = ctx.channel.id;

                if (/^(clear|none|unset|default)$/i.test(raw)) {
                    setRule(channelId, null);
                    sendBotMessage(channelId, { content: `Rule cleared. ${describeHere(channelId)}` });
                    return;
                }

                if (/^(off|never|no|0)$/i.test(raw)) {
                    setRule(channelId, 0);
                    sendBotMessage(channelId, { content: "AutoDelete will skip this channel entirely." });
                    return;
                }

                const seconds = parseDuration(raw);
                if (seconds == null) {
                    sendBotMessage(channelId, { content: `\`${raw}\` is not a duration I understand. Try \`45s\`, \`10m\`, \`2h\`, \`1d\`, \`off\` or \`clear\`.` });
                    return;
                }

                setRule(channelId, seconds);
                sendBotMessage(channelId, { content: `Your messages here will now last **${formatDuration(seconds)}**.` });
            }
        },
        {
            name: "autodelete server",
            description: "Set how long your messages last across this whole server",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{
                name: "timer",
                description: "A duration like 10m. Use 'off', or 'clear' to remove the rule",
                type: ApplicationCommandOptionType.STRING,
                required: true
            }],
            execute(args, ctx) {
                const guildId = ctx.guild?.id;
                if (!guildId) {
                    sendBotMessage(ctx.channel.id, { content: "This one only works inside a server." });
                    return;
                }

                const raw = findOption<string>(args, "timer", "").trim();

                if (/^(clear|none|unset|default)$/i.test(raw)) {
                    setRule(guildId, null);
                    sendBotMessage(ctx.channel.id, { content: "Server rule cleared." });
                    return;
                }

                if (/^(off|never|no|0)$/i.test(raw)) {
                    setRule(guildId, 0);
                    sendBotMessage(ctx.channel.id, { content: "AutoDelete will skip this server, except where a channel rule says otherwise." });
                    return;
                }

                const seconds = parseDuration(raw);
                if (seconds == null) {
                    sendBotMessage(ctx.channel.id, { content: `\`${raw}\` is not a duration I understand.` });
                    return;
                }

                setRule(guildId, seconds);
                sendBotMessage(ctx.channel.id, { content: `Server-wide: your messages will last **${formatDuration(seconds)}**, unless a channel rule overrides it.` });
            }
        },
        {
            name: "autodelete rules",
            description: "List every rule you have set",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute(_, ctx) {
                const rules = Object.entries(settings.store.rules ?? {});
                if (rules.length === 0) {
                    sendBotMessage(ctx.channel.id, { content: "No rules set. Right-click a channel or server, or use `/autodelete here`." });
                    return;
                }

                const lines = rules.map(([id, seconds]) => {
                    const channel = ChannelStore.getChannel(id);
                    const where = channel
                        ? channel.guild_id ? `#${channel.name}` : channel.name || "a DM"
                        : `server or category \`${id}\``;
                    return `· ${where}: ${seconds === 0 ? "off" : formatDuration(seconds)}`;
                });

                sendBotMessage(ctx.channel.id, { content: lines.join("\n") });
            }
        },
        {
            name: "autodelete arm",
            description: "Arm or disarm the timer without losing your rules",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{
                name: "state",
                description: "on or off",
                type: ApplicationCommandOptionType.STRING,
                required: true,
                choices: [
                    { label: "on", name: "on", value: "on" },
                    { label: "off", name: "off", value: "off" }
                ]
            }],
            execute(args, ctx) {
                settings.store.armed = findOption<string>(args, "state", "on") === "on";
                sendBotMessage(ctx.channel.id, {
                    content: settings.store.armed
                        ? "Armed. New messages will be scheduled again."
                        : `Disarmed. ${scheduler.pendingCount()} already-scheduled message(s) will still go. Use the toolbox to keep them.`
                });
            }
        }
    ],

    async start() {
        await scheduler.resume();
    },

    async stop() {
        await scheduler.shutdown();
    }
});
