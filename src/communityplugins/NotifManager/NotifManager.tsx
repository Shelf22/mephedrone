/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Heading } from "@components/Heading";
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import { Margins } from "@utils/margins";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { Button, ChannelStore, Forms, GuildChannelStore, GuildStore, React, RelationshipStore, SearchableSelect, Switch, Text, TextInput, Tooltip, useMemo, useReducer, useState, UserStore } from "@webpack/common";

import pluginSettings from "./settings";
import { addException, addToList, clearHistory, clearList, NotifManagerStore, removeFromList } from "./store";
import { HistoryEntry, KeywordMode, ListEntry } from "./types";

const cl = classNameFactory("notif-manager-");
const logger = new Logger("NotifManager");

interface PickerOption {
    label: string;
    value: string;
}

type EntriesTab = "servers" | "dms" | "gcs";

const HISTORY_VISIBLE_LIMIT = 100;
const MENTION_REGEX = /<@!?(\d+)>/g;

function truncate(content: string, max: number): string {
    if (content.length <= max) return content;
    return content.slice(0, max) + "...";
}

function resolveMentions(content: string): string {
    try {
        return content.replace(MENTION_REGEX, (_, userId: string) => {
            const user = UserStore.getUser(userId) as any;
            const name = user?.globalName ?? user?.username ?? userId;
            return `@${name}`;
        });
    } catch {
        return content;
    }
}

function parseCsv(value: string): string[] {
    return value.split(",").map(s => s.trim()).filter(s => s.length > 0);
}

function HistoryModal({ modalProps, history, onCleared }: { modalProps: ModalProps; history: HistoryEntry[]; onCleared: () => void; }) {
    const [entries, setEntries] = useState<HistoryEntry[]>(() => [...history].reverse().slice(0, HISTORY_VISIBLE_LIMIT));

    const handleClear = () => {
        clearHistory();
        setEntries([]);
        onCleared();
        modalProps.onClose();
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader separator>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>Suppressed Notification History</Text>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>

            <ModalContent className={cl("modal-content")}>
                {entries.length === 0 ? (
                    <Forms.FormText>No suppressed notifications.</Forms.FormText>
                ) : (
                    <div className={cl("history-list")}>
                        {entries.map(entry => (
                            <div key={entry.id} className={cl("history-item")}>
                                <div className={cl("history-title")}>{entry.sourceLabel}</div>
                                <Forms.FormText>From: {entry.senderName}</Forms.FormText>
                                <Forms.FormText>{truncate(resolveMentions(entry.content), 80)}</Forms.FormText>
                                <div className={cl("history-timestamp")}>
                                    {new Date(entry.timestamp).toLocaleString()}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </ModalContent>

            <ModalFooter>
                <Button
                    onClick={handleClear}
                    color={Button.Colors.RED}
                    size={Button.Sizes.SMALL}
                    disabled={entries.length === 0}
                >
                    Clear History
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

function VipUsersModal({ modalProps }: { modalProps: ModalProps; }) {
    const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
    const [search, setSearch] = useState("");

    const rows = useMemo(() => {
        const ids = parseCsv(pluginSettings.store.vipUsers);
        return ids.map(id => {
            const user = UserStore.getUser(id) as any;
            const label = user?.globalName ?? user?.username ?? id;
            return { id, label };
        }).sort((a, b) => a.label.localeCompare(b.label));
    }, [pluginSettings.store.vipUsers]);

    const filtered = rows.filter(r => r.label.toLowerCase().includes(search.toLowerCase()));

    const removeVipUser = (id: string) => {
        const current = parseCsv(pluginSettings.store.vipUsers);
        pluginSettings.store.vipUsers = current.filter(u => u !== id).join(",");
        forceUpdate();
    };

    const removeAll = () => {
        pluginSettings.store.vipUsers = "";
        forceUpdate();
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.SMALL}>
            <ModalHeader separator>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>Manage VIP Users</Text>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent className={cl("modal-content")}>
                <TextInput
                    placeholder="Search..."
                    value={search}
                    onChange={(v: string) => setSearch(v)}
                />
                <div style={{ maxHeight: "400px", overflowY: "auto", marginTop: "8px" }}>
                    {filtered.length === 0 ? (
                        <Text variant="text-md/normal">None</Text>
                    ) : (
                        filtered.map(row => (
                            <div
                                key={row.id}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    padding: "8px 0",
                                    borderBottom: "1px solid var(--background-tertiary)"
                                }}
                            >
                                <Text variant="text-md/normal" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexGrow: 1, minWidth: 0 }}>
                                    {row.label}
                                </Text>
                                <Button
                                    onClick={() => removeVipUser(row.id)}
                                    color={Button.Colors.RED}
                                    size={Button.Sizes.SMALL}
                                >
                                    Remove
                                </Button>
                            </div>
                        ))
                    )}
                </div>
            </ModalContent>
            <ModalFooter>
                <Button
                    onClick={modalProps.onClose}
                    color={Button.Colors.PRIMARY}
                    size={Button.Sizes.SMALL}
                >
                    Close
                </Button>
                <Button
                    onClick={removeAll}
                    color={Button.Colors.RED}
                    size={Button.Sizes.SMALL}
                    disabled={rows.length === 0}
                    style={{ marginRight: "8px" }}
                >
                    Remove All
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

function QHExceptionsModal({ modalProps }: { modalProps: ModalProps; }) {
    const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
    const [search, setSearch] = useState("");
    const [selectedGuildId, setSelectedGuildId] = useState<string | undefined>(undefined);
    const [selectedChannelId, setSelectedChannelId] = useState<string | undefined>(undefined);
    const [selectedDmId, setSelectedDmId] = useState<string | undefined>(undefined);
    const [selectedGcId, setSelectedGcId] = useState<string | undefined>(undefined);

    const rows = useMemo(() => {
        const ids = parseCsv(pluginSettings.store.quietHoursExceptions);
        return ids.map(id => {
            const guild = GuildStore.getGuild(id);
            if (guild?.name) return { id, label: guild.name };
            const channel = ChannelStore.getChannel(id);
            if (channel?.name) return { id, label: channel.name };
            const user = UserStore.getUser(id) as any;
            const userLabel = user?.globalName ?? user?.username;
            if (userLabel) return { id, label: userLabel };
            return { id, label: id };
        }).sort((a, b) => a.label.localeCompare(b.label));
    }, [pluginSettings.store.quietHoursExceptions]);

    const filtered = rows.filter(r => r.label.toLowerCase().includes(search.toLowerCase()));

    const guildOptions = useMemo<PickerOption[]>(() => {
        try {
            return GuildStore.getGuildsArray()
                .map(g => ({ label: g.name, value: g.id }))
                .sort((a, b) => a.label.localeCompare(b.label));
        } catch {
            return [];
        }
    }, []);

    const channelOptions = useMemo<PickerOption[]>(() => {
        if (!selectedGuildId) return [];
        try {
            const gc = GuildChannelStore.getChannels(selectedGuildId) as any;
            const selectable = (gc?.SELECTABLE ?? []) as Array<{ channel: any; }>;
            return selectable
                .map(e => e.channel)
                .filter(c => c?.name)
                .map(c => ({ label: `#${c.name}`, value: c.id }));
        } catch {
            return [];
        }
    }, [selectedGuildId]);

    const dmOptions = useMemo<PickerOption[]>(() => {
        try {
            return ChannelStore.getSortedPrivateChannels()
                .filter(c => c.type === 1)
                .map(c => {
                    const label = c.rawRecipients?.[0]?.username ?? c.id;
                    return { label, value: c.id };
                });
        } catch {
            return [];
        }
    }, []);

    const gcOptions = useMemo<PickerOption[]>(() => {
        try {
            return ChannelStore.getSortedPrivateChannels()
                .filter(c => c.type === 3)
                .map(c => {
                    let label = c.name ?? "";
                    if (!label && Array.isArray(c.rawRecipients) && c.rawRecipients.length > 0) {
                        label = c.rawRecipients.map(r => r.username).join(", ");
                    }
                    return { label: label || c.id, value: c.id };
                });
        } catch {
            return [];
        }
    }, []);

    const existingIds = parseCsv(pluginSettings.store.quietHoursExceptions);
    const availableGuildOptions = guildOptions.filter(o => !existingIds.includes(o.value));
    const availableDmOptions = dmOptions.filter(o => !existingIds.includes(o.value));
    const availableGcOptions = gcOptions.filter(o => !existingIds.includes(o.value));

    const addId = (id: string) => {
        const current = parseCsv(pluginSettings.store.quietHoursExceptions);
        if (current.includes(id)) return;
        pluginSettings.store.quietHoursExceptions = [...current, id].join(",");
        forceUpdate();
    };

    const addServer = () => {
        if (!selectedGuildId) return;
        addId(selectedGuildId);
        setSelectedGuildId(undefined);
        setSelectedChannelId(undefined);
    };

    const addChannel = () => {
        if (!selectedChannelId) return;
        addId(selectedChannelId);
        setSelectedChannelId(undefined);
    };

    const addDm = () => {
        if (!selectedDmId) return;
        addId(selectedDmId);
        setSelectedDmId(undefined);
    };

    const addGc = () => {
        if (!selectedGcId) return;
        addId(selectedGcId);
        setSelectedGcId(undefined);
    };

    const removeException = (id: string) => {
        const current = parseCsv(pluginSettings.store.quietHoursExceptions);
        pluginSettings.store.quietHoursExceptions = current.filter(v => v !== id).join(",");
        forceUpdate();
    };

    const removeAll = () => {
        pluginSettings.store.quietHoursExceptions = "";
        forceUpdate();
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader separator>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>Quiet Hours Exceptions</Text>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent className={cl("modal-content")}>
                <div style={{ display: "flex", gap: "16px" }}>
                    <div style={{ flex: 1 }}>
                        <Heading tag="h5">Add Exceptions</Heading>

                        <div className={Margins.bottom16}>
                            <Heading tag="h5">Servers</Heading>
                            <SearchableSelect
                                placeholder="Select a server"
                                options={availableGuildOptions}
                                value={availableGuildOptions.find(o => o.value === selectedGuildId)?.value}
                                onChange={v => { setSelectedGuildId(v); setSelectedChannelId(undefined); }}
                                maxVisibleItems={8}
                                closeOnSelect
                            />
                            {selectedGuildId && (
                                <>
                                    <Heading tag="h5">Channel (optional)</Heading>
                                    <SearchableSelect
                                        placeholder="Select a channel"
                                        options={channelOptions}
                                        value={channelOptions.find(o => o.value === selectedChannelId)?.value}
                                        onChange={v => setSelectedChannelId(v)}
                                        maxVisibleItems={8}
                                        closeOnSelect
                                    />
                                </>
                            )}
                            <div className={cl("button-row")} style={{ marginTop: "8px", marginBottom: "8px", display: "flex", gap: "8px" }}>
                                <Button
                                    onClick={addServer}
                                    color={Button.Colors.BRAND}
                                    size={Button.Sizes.SMALL}
                                    disabled={!selectedGuildId}
                                >
                                    Add Server
                                </Button>
                                <Button
                                    onClick={addChannel}
                                    color={Button.Colors.BRAND}
                                    size={Button.Sizes.SMALL}
                                    disabled={!selectedGuildId || !selectedChannelId}
                                >
                                    Add Channel
                                </Button>
                            </div>
                        </div>

                        <div className={Margins.bottom16}>
                            <Heading tag="h5">Direct Messages</Heading>
                            <SearchableSelect
                                placeholder="Select a DM"
                                options={availableDmOptions}
                                value={availableDmOptions.find(o => o.value === selectedDmId)?.value}
                                onChange={v => setSelectedDmId(v)}
                                maxVisibleItems={8}
                                closeOnSelect
                            />
                            <div className={cl("button-row")} style={{ marginTop: "8px", marginBottom: "8px" }}>
                                <Button
                                    onClick={addDm}
                                    color={Button.Colors.BRAND}
                                    size={Button.Sizes.SMALL}
                                    disabled={!selectedDmId}
                                >
                                    Add DM
                                </Button>
                            </div>
                        </div>

                        <div className={Margins.bottom16}>
                            <Heading tag="h5">Group Chats</Heading>
                            <SearchableSelect
                                placeholder="Select a group chat"
                                options={availableGcOptions}
                                value={availableGcOptions.find(o => o.value === selectedGcId)?.value}
                                onChange={v => setSelectedGcId(v)}
                                maxVisibleItems={8}
                                closeOnSelect
                            />
                            <div className={cl("button-row")} style={{ marginTop: "8px", marginBottom: "8px" }}>
                                <Button
                                    onClick={addGc}
                                    color={Button.Colors.BRAND}
                                    size={Button.Sizes.SMALL}
                                    disabled={!selectedGcId}
                                >
                                    Add Group Chat
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div style={{ flex: 1 }}>
                        <Heading tag="h5">Current Exceptions</Heading>
                        <TextInput
                            placeholder="Search..."
                            value={search}
                            onChange={(v: string) => setSearch(v)}
                        />
                        <div style={{ maxHeight: "400px", overflowY: "auto", marginTop: "8px" }}>
                            {filtered.length === 0 ? (
                                <Text variant="text-md/normal">None</Text>
                            ) : (
                                filtered.map(row => (
                                    <div
                                        key={row.id}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            padding: "8px 0",
                                            borderBottom: "1px solid var(--background-tertiary)"
                                        }}
                                    >
                                        <Text variant="text-md/normal" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexGrow: 1, minWidth: 0 }}>
                                            {row.label}
                                        </Text>
                                        <Button
                                            onClick={() => removeException(row.id)}
                                            color={Button.Colors.RED}
                                            size={Button.Sizes.SMALL}
                                        >
                                            Remove
                                        </Button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </ModalContent>
            <ModalFooter>
                <Button
                    onClick={modalProps.onClose}
                    color={Button.Colors.PRIMARY}
                    size={Button.Sizes.SMALL}
                >
                    Close
                </Button>
                <Button
                    onClick={removeAll}
                    color={Button.Colors.RED}
                    size={Button.Sizes.SMALL}
                    disabled={rows.length === 0}
                    style={{ marginRight: "8px" }}
                >
                    Remove All
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

function EntriesModal({ modalProps, onChanged }: { modalProps: ModalProps; onChanged: () => void; }) {
    const [activeTab, setActiveTab] = useState<EntriesTab>("servers");
    const [serverSearch, setServerSearch] = useState("");
    const [dmSearch, setDmSearch] = useState("");
    const [gcSearch, setGcSearch] = useState("");
    const [exceptionOpenForServerId, setExceptionOpenForServerId] = useState<string | undefined>(undefined);
    const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
    const pickerRef = React.useRef<HTMLDivElement | null>(null);

    React.useEffect(() => {
        if (!exceptionOpenForServerId) return;
        const onMouseDown = (e: MouseEvent) => {
            if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
                setExceptionOpenForServerId(undefined);
            }
        };
        document.addEventListener("mousedown", onMouseDown);
        return () => document.removeEventListener("mousedown", onMouseDown);
    }, [exceptionOpenForServerId]);

    const list = NotifManagerStore.list;

    const exceptionChannelOptions = useMemo<PickerOption[]>(() => {
        if (!exceptionOpenForServerId) return [];
        try {
            const gc = GuildChannelStore.getChannels(exceptionOpenForServerId) as any;
            const selectable = (gc?.SELECTABLE ?? []) as Array<{ channel: any; }>;
            return selectable
                .map(e => e.channel)
                .filter(c => c?.name)
                .map(c => ({ label: `#${c.name}`, value: c.id }));
        } catch {
            return [];
        }
    }, [exceptionOpenForServerId]);

    const handleRemove = (id: string) => {
        removeFromList(id);
        forceUpdate();
        onChanged();
    };

    const clearManualOfType = (type: "server" | "dm" | "gc") => {
        const ids = NotifManagerStore.list
            .filter(e => e.type === type && e.fromQuickAction !== true)
            .map(e => e.id);
        for (const id of ids) removeFromList(id);
        forceUpdate();
        onChanged();
    };

    const addAllServers = () => {
        try {
            const guilds = GuildStore.getGuildsArray();
            for (const guild of guilds) {
                addToList({ type: "server", id: guild.id, label: guild.name }, undefined, false);
            }
            forceUpdate();
            onChanged();
        } catch (e) {
            logger.error("Failed to add all servers", e);
        }
    };

    const addAllDms = () => {
        try {
            const channels = ChannelStore.getSortedPrivateChannels().filter(c => c.type === 1);
            for (const channel of channels) {
                const label = (channel as any).rawRecipients?.[0]?.username ?? channel.id;
                addToList({ type: "dm", id: channel.id, label }, undefined, false);
            }
            forceUpdate();
            onChanged();
        } catch (e) {
            logger.error("Failed to add all DMs", e);
        }
    };

    const addAllGcs = () => {
        try {
            const channels = ChannelStore.getSortedPrivateChannels().filter(c => c.type === 3);
            for (const channel of channels) {
                let label = channel.name ?? "";
                if (!label) {
                    const recipients = (channel as any).rawRecipients;
                    label = Array.isArray(recipients) && recipients.length > 0
                        ? recipients.map((r: any) => r.username).join(", ")
                        : channel.id;
                }
                addToList({ type: "gc", id: channel.id, label }, undefined, false);
            }
            forceUpdate();
            onChanged();
        } catch (e) {
            logger.error("Failed to add all GCs", e);
        }
    };

    const onSelectException = (channelId: string | null | undefined) => {
        if (!channelId) {
            setExceptionOpenForServerId(undefined);
            return;
        }
        if (!exceptionOpenForServerId) return;
        const channelLabel = exceptionChannelOptions.find(o => o.value === channelId)?.label ?? channelId;
        const guildName = GuildStore.getGuild(exceptionOpenForServerId)?.name ?? exceptionOpenForServerId;
        const fullLabel = `${guildName} ${channelLabel}`;
        addException(exceptionOpenForServerId, channelId, fullLabel);
        setExceptionOpenForServerId(undefined);
        forceUpdate();
        onChanged();
    };

    const filterAndSort = (entries: ListEntry[], query: string) => {
        const q = query.toLowerCase();
        return entries
            .filter(e => e.label.toLowerCase().includes(q))
            .sort((a, b) => a.label.localeCompare(b.label));
    };

    const renderRow = (entry: ListEntry, indent = false) => (
        <React.Fragment key={entry.id}>
            <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "4px 0",
                paddingLeft: indent ? "20px" : "0",
                borderBottom: "1px solid var(--background-tertiary)"
            }}>
                <Text variant="text-sm/normal" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexGrow: 1, minWidth: 0 }}>
                    {entry.label}
                </Text>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                    {entry.type === "server" && (
                        <Tooltip text="Add a channel exception - messages from this channel bypass server suppression">
                            {({ onMouseEnter, onMouseLeave }) => (
                                <Button
                                    onClick={() => setExceptionOpenForServerId(
                                        exceptionOpenForServerId === entry.id ? undefined : entry.id
                                    )}
                                    color={Button.Colors.PRIMARY}
                                    size={Button.Sizes.SMALL}
                                    onMouseEnter={onMouseEnter}
                                    onMouseLeave={onMouseLeave}
                                >
                                    Ch Exception
                                </Button>
                            )}
                        </Tooltip>
                    )}
                    <Button
                        onClick={() => handleRemove(entry.id)}
                        color={Button.Colors.RED}
                        size={Button.Sizes.SMALL}
                    >
                        Remove
                    </Button>
                </div>
            </div>
            {entry.type === "server" && exceptionOpenForServerId === entry.id && (
                <div ref={pickerRef} style={{ padding: "8px 12px", background: "var(--background-tertiary)", borderRadius: "4px", marginBottom: "4px", marginLeft: 0 }}>
                    <Forms.FormText style={{ marginBottom: "4px" }}>Select a channel to add as exception:</Forms.FormText>
                    <SearchableSelect
                        placeholder="Select a channel to add as exception"
                        options={exceptionChannelOptions}
                        value={undefined}
                        onChange={v => onSelectException(v)}
                        onClose={() => setExceptionOpenForServerId(undefined)}
                        maxVisibleItems={8}
                        closeOnSelect
                    />
                </div>
            )}
        </React.Fragment>
    );

    const renderServersTab = () => {
        const servers = filterAndSort(list.filter(e => e.type === "server"), serverSearch);
        const channelEntries = filterAndSort(list.filter(e => e.type === "channel"), serverSearch);
        const exceptionsByParent = new Map<string, ListEntry[]>();
        for (const e of list.filter(e => e.type === "channel-exception")) {
            const pid = e.parentServerId ?? "";
            if (!exceptionsByParent.has(pid)) exceptionsByParent.set(pid, []);
            exceptionsByParent.get(pid)!.push(e);
        }
        for (const arr of exceptionsByParent.values()) {
            arr.sort((a, b) => a.label.localeCompare(b.label));
        }
        const topServerIds = new Set(servers.map(s => s.id));
        const orphan = filterAndSort(
            list.filter(e => e.type === "channel-exception" && !topServerIds.has(e.parentServerId ?? "")),
            serverSearch
        );

        const hasAny = servers.length > 0 || channelEntries.length > 0 || orphan.length > 0;

        return (
            <>
                <TextInput
                    placeholder="Search..."
                    value={serverSearch}
                    onChange={(v: string) => setServerSearch(v)}
                />
                <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                    <Button
                        onClick={addAllServers}
                        color={Button.Colors.PRIMARY}
                        size={Button.Sizes.SMALL}
                    >
                        Add All Servers
                    </Button>
                    <Button
                        onClick={() => clearManualOfType("server")}
                        color={Button.Colors.RED}
                        size={Button.Sizes.SMALL}
                    >
                        Clear Servers
                    </Button>
                </div>
                <div style={{ maxHeight: "400px", overflowY: "auto", marginTop: "8px" }}>
                    {!hasAny ? (
                        <Text variant="text-sm/normal">None</Text>
                    ) : (
                        <>
                            {servers.map(s => (
                                <React.Fragment key={s.id}>
                                    {renderRow(s)}
                                    {(exceptionsByParent.get(s.id) ?? []).map(ex => renderRow(ex, true))}
                                </React.Fragment>
                            ))}
                            {channelEntries.map(c => renderRow(c))}
                            {orphan.map(ex => renderRow(ex, true))}
                        </>
                    )}
                </div>
            </>
        );
    };

    const renderSimpleTab = (type: "dm" | "gc", search: string, setSearch: (s: string) => void) => {
        const entries = filterAndSort(list.filter(e => e.type === type), search);
        const clearLabel = type === "dm" ? "Clear DMs" : "Clear Group Chats";
        const addAllLabel = type === "dm" ? "Add All DMs" : "Add All GCs";
        const addAll = type === "dm" ? addAllDms : addAllGcs;
        return (
            <>
                <TextInput
                    placeholder="Search..."
                    value={search}
                    onChange={(v: string) => setSearch(v)}
                />
                <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                    <Button
                        onClick={addAll}
                        color={Button.Colors.PRIMARY}
                        size={Button.Sizes.SMALL}
                    >
                        {addAllLabel}
                    </Button>
                    <Button
                        onClick={() => clearManualOfType(type)}
                        color={Button.Colors.RED}
                        size={Button.Sizes.SMALL}
                    >
                        {clearLabel}
                    </Button>
                </div>
                <div style={{ maxHeight: "400px", overflowY: "auto", marginTop: "8px" }}>
                    {entries.length === 0 ? (
                        <Text variant="text-sm/normal">None</Text>
                    ) : (
                        entries.map(e => renderRow(e))
                    )}
                </div>
            </>
        );
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader separator>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>Manage Entries</Text>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent className={cl("modal-content")}>
                <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                    <Button
                        onClick={() => setActiveTab("servers")}
                        color={activeTab === "servers" ? Button.Colors.BRAND : Button.Colors.PRIMARY}
                        size={Button.Sizes.SMALL}
                    >
                        Servers
                    </Button>
                    <Button
                        onClick={() => setActiveTab("dms")}
                        color={activeTab === "dms" ? Button.Colors.BRAND : Button.Colors.PRIMARY}
                        size={Button.Sizes.SMALL}
                    >
                        DMs
                    </Button>
                    <Button
                        onClick={() => setActiveTab("gcs")}
                        color={activeTab === "gcs" ? Button.Colors.BRAND : Button.Colors.PRIMARY}
                        size={Button.Sizes.SMALL}
                    >
                        Group Chats
                    </Button>
                </div>
                {activeTab === "servers" && renderServersTab()}
                {activeTab === "dms" && renderSimpleTab("dm", dmSearch, setDmSearch)}
                {activeTab === "gcs" && renderSimpleTab("gc", gcSearch, setGcSearch)}
            </ModalContent>
            <ModalFooter>
                <Button
                    onClick={modalProps.onClose}
                    color={Button.Colors.PRIMARY}
                    size={Button.Sizes.SMALL}
                >
                    Close
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

export function QuickActionsSection() {
    const { muteAllDMs, muteAllGCs, muteAllServers } = pluginSettings.use(["muteAllDMs", "muteAllGCs", "muteAllServers"]);
    const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

    const toggleMuteAllDMs = () => {
        try {
            const next = !pluginSettings.store.muteAllDMs;
            pluginSettings.store.muteAllDMs = next;
            if (next) {
                const existingIds = new Set(NotifManagerStore.list.map(e => e.id));
                const channels = ChannelStore.getSortedPrivateChannels().filter(c => c.type === 1);
                for (const channel of channels) {
                    if (existingIds.has(channel.id)) continue;
                    const label = (channel as any).rawRecipients?.[0]?.username ?? channel.id;
                    addToList({ type: "dm", id: channel.id, label }, undefined, true);
                }
            } else {
                const toRemove = NotifManagerStore.list.filter(e => e.fromQuickAction === true && e.type === "dm");
                for (const entry of toRemove) {
                    removeFromList(entry.id);
                }
            }
            forceUpdate();
        } catch (e) {
            logger.error("Failed to toggle muteAllDMs", e);
        }
    };

    const toggleMuteAllGCs = () => {
        try {
            const next = !pluginSettings.store.muteAllGCs;
            pluginSettings.store.muteAllGCs = next;
            if (next) {
                const existingIds = new Set(NotifManagerStore.list.map(e => e.id));
                const channels = ChannelStore.getSortedPrivateChannels().filter(c => c.type === 3);
                for (const channel of channels) {
                    if (existingIds.has(channel.id)) continue;
                    let label = channel.name ?? "";
                    if (!label) {
                        const recipients = (channel as any).rawRecipients;
                        label = Array.isArray(recipients) && recipients.length > 0
                            ? recipients.map((r: any) => r.username).join(", ")
                            : channel.id;
                    }
                    addToList({ type: "gc", id: channel.id, label }, undefined, true);
                }
            } else {
                const toRemove = NotifManagerStore.list.filter(e => e.fromQuickAction === true && e.type === "gc");
                for (const entry of toRemove) {
                    removeFromList(entry.id);
                }
            }
            forceUpdate();
        } catch (e) {
            logger.error("Failed to toggle muteAllGCs", e);
        }
    };

    const toggleMuteAllServers = () => {
        try {
            const next = !pluginSettings.store.muteAllServers;
            pluginSettings.store.muteAllServers = next;
            if (next) {
                const existingIds = new Set(NotifManagerStore.list.map(e => e.id));
                const guilds = GuildStore.getGuildsArray();
                for (const guild of guilds) {
                    if (existingIds.has(guild.id)) continue;
                    addToList({ type: "server", id: guild.id, label: guild.name }, undefined, true);
                }
            } else {
                const toRemove = NotifManagerStore.list.filter(e => e.fromQuickAction === true && e.type === "server");
                for (const entry of toRemove) {
                    removeFromList(entry.id);
                }
            }
            forceUpdate();
        } catch (e) {
            logger.error("Failed to toggle muteAllServers", e);
        }
    };

    return (
        <section className={Margins.bottom16}>
            <Heading tag="h2">Quick Actions</Heading>
            <Forms.FormText className={Margins.bottom8}>Toggle to suppress all notifications of that type.</Forms.FormText>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                <Button
                    onClick={toggleMuteAllDMs}
                    color={muteAllDMs ? Button.Colors.BRAND : Button.Colors.PRIMARY}
                    size={Button.Sizes.SMALL}
                >
                    All DMs
                </Button>
                <Button
                    onClick={toggleMuteAllGCs}
                    color={muteAllGCs ? Button.Colors.BRAND : Button.Colors.PRIMARY}
                    size={Button.Sizes.SMALL}
                >
                    All Group Chats
                </Button>
                <Button
                    onClick={toggleMuteAllServers}
                    color={muteAllServers ? Button.Colors.BRAND : Button.Colors.PRIMARY}
                    size={Button.Sizes.SMALL}
                >
                    All Servers
                </Button>
            </div>
        </section>
    );
}

export function ListManagerSection() {
    const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

    const [selectedGuildId, setSelectedGuildId] = useState<string | undefined>(undefined);
    const [selectedChannelId, setSelectedChannelId] = useState<string | undefined>(undefined);
    const [selectedDmId, setSelectedDmId] = useState<string | undefined>(undefined);
    const [selectedGcId, setSelectedGcId] = useState<string | undefined>(undefined);

    const { list } = NotifManagerStore;

    const guildOptions = useMemo<PickerOption[]>(() => {
        try {
            return GuildStore.getGuildsArray()
                .map(g => ({ label: g.name, value: g.id }))
                .sort((a, b) => a.label.localeCompare(b.label));
        } catch {
            return [];
        }
    }, []);

    const channelOptions = useMemo<PickerOption[]>(() => {
        if (!selectedGuildId) return [];
        try {
            const gc = GuildChannelStore.getChannels(selectedGuildId) as any;
            const selectable = (gc?.SELECTABLE ?? []) as Array<{ channel: any; }>;
            return selectable
                .map(e => e.channel)
                .filter(c => c?.name)
                .map(c => ({ label: `#${c.name}`, value: c.id }));
        } catch {
            return [];
        }
    }, [selectedGuildId]);

    const dmOptions = useMemo<PickerOption[]>(() => {
        try {
            return ChannelStore.getSortedPrivateChannels()
                .filter(c => c.type === 1)
                .map(c => {
                    const label = c.rawRecipients?.[0]?.username ?? c.id;
                    return { label, value: c.id };
                });
        } catch {
            return [];
        }
    }, []);

    const gcOptions = useMemo<PickerOption[]>(() => {
        try {
            return ChannelStore.getSortedPrivateChannels()
                .filter(c => c.type === 3)
                .map(c => {
                    let label = c.name ?? "";
                    if (!label && Array.isArray(c.rawRecipients) && c.rawRecipients.length > 0) {
                        label = c.rawRecipients.map(r => r.username).join(", ");
                    }
                    return { label: label || c.id, value: c.id };
                });
        } catch {
            return [];
        }
    }, []);

    const availableGuildOptions = guildOptions.filter(o => !NotifManagerStore.list.some(e => e.id === o.value));
    const availableDmOptions = dmOptions.filter(o => !NotifManagerStore.list.some(e => e.id === o.value));
    const availableGcOptions = gcOptions.filter(o => !NotifManagerStore.list.some(e => e.id === o.value));

    const addServer = () => {
        if (!selectedGuildId) return;
        const label = guildOptions.find(o => o.value === selectedGuildId)?.label ?? selectedGuildId;
        addToList({ type: "server", id: selectedGuildId, label }, forceUpdate);
        setSelectedGuildId(undefined);
        setSelectedChannelId(undefined);
    };

    const addChannel = () => {
        if (!selectedGuildId || !selectedChannelId) return;
        const label = channelOptions.find(o => o.value === selectedChannelId)?.label ?? selectedChannelId;
        addToList({ type: "channel", id: selectedChannelId, label }, forceUpdate);
        setSelectedChannelId(undefined);
    };

    const addDm = () => {
        if (!selectedDmId) return;
        const label = dmOptions.find(o => o.value === selectedDmId)?.label ?? selectedDmId;
        addToList({ type: "dm", id: selectedDmId, label }, forceUpdate);
        setSelectedDmId(undefined);
    };

    const addGc = () => {
        if (!selectedGcId) return;
        const label = gcOptions.find(o => o.value === selectedGcId)?.label ?? selectedGcId;
        addToList({ type: "gc", id: selectedGcId, label }, forceUpdate);
        setSelectedGcId(undefined);
    };

    const handleClearAll = () => {
        clearList(forceUpdate);
        pluginSettings.store.muteAllDMs = false;
        pluginSettings.store.muteAllGCs = false;
        pluginSettings.store.muteAllServers = false;
    };

    const openEntriesModal = () => {
        openModal(modalProps => (
            <EntriesModal
                modalProps={modalProps}
                onChanged={forceUpdate}
            />
        ));
    };

    const listModeDescription = pluginSettings.use(["mode"]).mode === "blacklist"
        ? "Sources on this list will have their notifications suppressed."
        : "Only sources on this list will be allowed to send notifications.";

    return (
        <section className={Margins.bottom16}>
            <Heading tag="h2">List Manager</Heading>
            <Forms.FormText className={Margins.bottom8}>{listModeDescription}</Forms.FormText>

            <div className={Margins.bottom16}>
                <Heading tag="h5">Servers</Heading>
                <SearchableSelect
                    placeholder="Select a server"
                    options={availableGuildOptions}
                    value={availableGuildOptions.find(o => o.value === selectedGuildId)?.value}
                    onChange={v => { setSelectedGuildId(v); setSelectedChannelId(undefined); }}
                    maxVisibleItems={8}
                    closeOnSelect
                />

                {selectedGuildId && (
                    <>
                        <Heading tag="h5">Channel (optional)</Heading>
                        <SearchableSelect
                            placeholder="Select a channel"
                            options={channelOptions}
                            value={channelOptions.find(o => o.value === selectedChannelId)?.value}
                            onChange={v => setSelectedChannelId(v)}
                            maxVisibleItems={8}
                            closeOnSelect
                        />
                    </>
                )}

                <div className={cl("button-row")} style={{ marginTop: "8px", marginBottom: "8px" }}>
                    <Button
                        onClick={addServer}
                        color={Button.Colors.BRAND}
                        size={Button.Sizes.SMALL}
                        disabled={!selectedGuildId}
                    >
                        Add Server
                    </Button>
                    <Button
                        onClick={addChannel}
                        color={Button.Colors.BRAND}
                        size={Button.Sizes.SMALL}
                        disabled={!selectedGuildId || !selectedChannelId}
                    >
                        Add Channel
                    </Button>
                </div>
            </div>

            <div className={Margins.bottom16}>
                <Heading tag="h5">Direct Messages</Heading>
                <SearchableSelect
                    placeholder="Select a DM"
                    options={availableDmOptions}
                    value={availableDmOptions.find(o => o.value === selectedDmId)?.value}
                    onChange={v => setSelectedDmId(v)}
                    maxVisibleItems={8}
                    closeOnSelect
                />
                <div className={cl("button-row")} style={{ marginTop: "8px", marginBottom: "8px" }}>
                    <Button
                        onClick={addDm}
                        color={Button.Colors.BRAND}
                        size={Button.Sizes.SMALL}
                        disabled={!selectedDmId}
                    >
                        Add DM
                    </Button>
                </div>
            </div>

            <div className={Margins.bottom16}>
                <Heading tag="h5">Group Chats</Heading>
                <SearchableSelect
                    placeholder="Select a group chat"
                    options={availableGcOptions}
                    value={availableGcOptions.find(o => o.value === selectedGcId)?.value}
                    onChange={v => setSelectedGcId(v)}
                    maxVisibleItems={8}
                    closeOnSelect
                />
                <div className={cl("button-row")} style={{ marginTop: "8px", marginBottom: "8px" }}>
                    <Button
                        onClick={addGc}
                        color={Button.Colors.BRAND}
                        size={Button.Sizes.SMALL}
                        disabled={!selectedGcId}
                    >
                        Add Group Chat
                    </Button>
                </div>
            </div>

            <Heading tag="h5">Entries</Heading>
            <Forms.FormText>
                {list.length === 0
                    ? "No entries yet."
                    : `${list.length} ${list.length === 1 ? "entry" : "entries"}`}
            </Forms.FormText>
            <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <Button
                    onClick={openEntriesModal}
                    color={Button.Colors.PRIMARY}
                    size={Button.Sizes.SMALL}
                    disabled={list.length === 0}
                >
                    Manage Entries
                </Button>
                <Button
                    onClick={handleClearAll}
                    color={Button.Colors.RED}
                    size={Button.Sizes.SMALL}
                    disabled={list.length === 0}
                >
                    Clear All Entries
                </Button>
            </div>
        </section>
    );
}

export function AdvancedSection() {
    const [open, setOpen] = useState(false);
    const [selectedVipUserId, setSelectedVipUserId] = useState<string | undefined>(undefined);

    const {
        quietHoursEnabled,
        quietHoursStart,
        quietHoursEnd,
        quietHoursAllowMentions,
        quietHoursAllowDirectMessages,
        quietHoursExceptions,
        vipUsers,
        keywordMode,
        keywords,
        muteAllSounds,
        muteAllPopups
    } = pluginSettings.use([
        "quietHoursEnabled",
        "quietHoursStart",
        "quietHoursEnd",
        "quietHoursAllowMentions",
        "quietHoursAllowDirectMessages",
        "quietHoursExceptions",
        "vipUsers",
        "keywordMode",
        "keywords",
        "muteAllSounds",
        "muteAllPopups"
    ]);

    const userOptions = useMemo<PickerOption[]>(() => {
        try {
            const friendIds = RelationshipStore.getFriendIDs();
            const dmUserIds = ChannelStore.getDMUserIds();
            const unique = Array.from(new Set([...friendIds, ...dmUserIds]));
            const opts: PickerOption[] = [];
            for (const id of unique) {
                const user = UserStore.getUser(id) as any;
                if (!user) continue;
                const label = user.globalName ?? user.username ?? id;
                opts.push({ label, value: id });
            }
            return opts.sort((a, b) => a.label.localeCompare(b.label));
        } catch {
            return [];
        }
    }, []);

    const vipUserCount = useMemo(() => parseCsv(vipUsers).length, [vipUsers]);

    const addVipUser = () => {
        if (!selectedVipUserId) return;
        const current = parseCsv(vipUsers);
        if (current.includes(selectedVipUserId)) {
            setSelectedVipUserId(undefined);
            return;
        }
        pluginSettings.store.vipUsers = [...current, selectedVipUserId].join(",");
        setSelectedVipUserId(undefined);
    };

    const openVipUsersModal = () => {
        openModal(modalProps => <VipUsersModal modalProps={modalProps} />);
    };

    const keywordModeOptions: PickerOption[] = [
        { label: "Suppress", value: "suppress" },
        { label: "Allow Only", value: "allow" }
    ];

    return (
        <section className={Margins.bottom16}>
            <div
                onClick={() => setOpen(v => !v)}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    cursor: "pointer",
                    userSelect: "none",
                    padding: "6px 0"
                }}
            >
                <span
                    style={{
                        display: "inline-block",
                        transform: open ? "rotate(90deg)" : "rotate(0deg)",
                        transition: "transform 0.15s",
                        fontSize: "12px",
                        color: "var(--text-muted)"
                    }}
                >
                    ▶
                </span>
                <Heading tag="h2" style={{ margin: 0 }}>Advanced Settings</Heading>
            </div>

            {open && (
                <div className={Margins.top8}>
                    <div className={Margins.bottom16}>
                        <Heading tag="h5">Global Suppression</Heading>
                        <Switch
                            value={muteAllSounds}
                            onChange={(v: boolean) => { pluginSettings.store.muteAllSounds = v; }}
                            note="Mute all Discord notification sounds globally."
                        >
                            Mute all sounds
                        </Switch>
                        <Switch
                            value={muteAllPopups}
                            onChange={(v: boolean) => { pluginSettings.store.muteAllPopups = v; }}
                            note="Suppress all Discord desktop notification popups globally."
                        >
                            Mute all popups
                        </Switch>
                    </div>

                    <div className={Margins.bottom16}>
                        <Heading tag="h5">Quiet Hours</Heading>
                        <Switch
                            value={quietHoursEnabled}
                            onChange={(v: boolean) => { pluginSettings.store.quietHoursEnabled = v; }}
                            note="Suppress notifications within a configured time window."
                        >
                            Enable quiet hours
                        </Switch>

                        {quietHoursEnabled && (
                            <>
                                <Forms.FormTitle tag="h5">Start (HH:MM, 24-hour)</Forms.FormTitle>
                                <TextInput
                                    value={quietHoursStart}
                                    onChange={(v: string) => { pluginSettings.store.quietHoursStart = v; }}
                                    placeholder="22:00"
                                />

                                <Forms.FormTitle tag="h5">End (HH:MM, 24-hour)</Forms.FormTitle>
                                <TextInput
                                    value={quietHoursEnd}
                                    onChange={(v: string) => { pluginSettings.store.quietHoursEnd = v; }}
                                    placeholder="08:00"
                                />

                                <div style={{ marginTop: "8px" }}>
                                    <Switch
                                        value={quietHoursAllowMentions}
                                        onChange={(v: boolean) => { pluginSettings.store.quietHoursAllowMentions = v; }}
                                        note="Let @mentions break through quiet hours."
                                    >
                                        Allow mentions during quiet hours
                                    </Switch>
                                </div>

                                <Switch
                                    value={quietHoursAllowDirectMessages}
                                    onChange={(v: boolean) => { pluginSettings.store.quietHoursAllowDirectMessages = v; }}
                                    note="Let direct messages break through quiet hours."
                                >
                                    Allow DMs during quiet hours
                                </Switch>
                            </>
                        )}
                    </div>

                    <div className={Margins.bottom16} style={{ marginTop: "16px", marginBottom: "16px" }}>
                        <Heading tag="h5" style={{ marginBottom: "8px" }}>Quiet Hours Exceptions</Heading>
                        <Forms.FormText style={{ marginBottom: "8px" }}>
                            Servers, channels, DMs, or group chats that bypass quiet hours suppression regardless of blacklist status.
                        </Forms.FormText>
                        <Button
                            onClick={() => openModal(modalProps => <QHExceptionsModal modalProps={modalProps} />)}
                            color={Button.Colors.PRIMARY}
                            size={Button.Sizes.SMALL}
                        >
                            Manage QH Exceptions
                        </Button>
                        <Forms.FormText style={{ marginTop: "8px" }}>
                            {(() => {
                                const count = parseCsv(quietHoursExceptions).length;
                                if (count === 0) return "No quiet hours exceptions configured.";
                                return `${count} quiet hours exception${count === 1 ? "" : "s"} configured`;
                            })()}
                        </Forms.FormText>
                    </div>

                    <div className={Margins.bottom16}>
                        <Heading tag="h5">VIP Users</Heading>
                        <Forms.FormText className={Margins.bottom8}>
                            Notifications from these users always bypass suppression.
                        </Forms.FormText>
                        <SearchableSelect
                            placeholder="Select a user"
                            options={userOptions}
                            value={userOptions.find(o => o.value === selectedVipUserId)?.value}
                            onChange={v => setSelectedVipUserId(v)}
                            maxVisibleItems={8}
                            closeOnSelect
                        />
                        <div className={cl("button-row")} style={{ marginTop: "8px", marginBottom: "8px", display: "flex", gap: "8px" }}>
                            <Button
                                onClick={addVipUser}
                                color={Button.Colors.BRAND}
                                size={Button.Sizes.SMALL}
                                disabled={!selectedVipUserId}
                            >
                                Add VIP User
                            </Button>
                            <Button
                                onClick={openVipUsersModal}
                                color={Button.Colors.PRIMARY}
                                size={Button.Sizes.SMALL}
                                disabled={vipUserCount === 0}
                            >
                                Manage VIP Users
                            </Button>
                            {vipUsers.trim().length > 0 && (
                                <Button
                                    onClick={() => { pluginSettings.store.vipUsers = ""; }}
                                    color={Button.Colors.RED}
                                    size={Button.Sizes.SMALL}
                                >
                                    Remove All
                                </Button>
                            )}
                        </div>
                        <Forms.FormText>
                            {vipUserCount === 0
                                ? "No VIP users configured."
                                : `${vipUserCount} VIP user${vipUserCount === 1 ? "" : "s"} configured`}
                        </Forms.FormText>
                    </div>

                    <div className={Margins.bottom16}>
                        <Heading tag="h5">Keyword Filter</Heading>
                        <Forms.FormText className={Margins.bottom8}>
                            Match messages against a comma-separated keyword list.
                        </Forms.FormText>
                        <SearchableSelect
                            placeholder="Select keyword mode"
                            options={keywordModeOptions}
                            value={keywordModeOptions.find(o => o.value === keywordMode)?.value}
                            onChange={v => { pluginSettings.store.keywordMode = v as KeywordMode; }}
                            maxVisibleItems={4}
                            closeOnSelect
                        />
                        <Forms.FormTitle tag="h5" style={{ marginTop: "8px" }}>Keywords</Forms.FormTitle>
                        <TextInput
                            value={keywords}
                            onChange={(v: string) => { pluginSettings.store.keywords = v; }}
                            placeholder="urgent, deploy, incident"
                        />
                        {keywords.length > 0 && (
                            <div style={{ marginTop: "8px" }}>
                                <Button
                                    onClick={() => { pluginSettings.store.keywords = ""; }}
                                    color={Button.Colors.RED}
                                    size={Button.Sizes.SMALL}
                                >
                                    Clear Keywords
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </section>
    );
}

export function SuppressedHistorySection() {
    const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
    const { history } = NotifManagerStore;

    const openHistoryModal = () => {
        openModal(modalProps => (
            <HistoryModal
                modalProps={modalProps}
                history={history}
                onCleared={forceUpdate}
            />
        ));
    };

    return (
        <section className={Margins.bottom16}>
            <Heading tag="h2" style={{ marginBottom: 0 }}>Suppressed History</Heading>
            <Forms.FormText style={{ marginTop: 0 }} className={Margins.bottom8}>
                {history.length === 0
                    ? "No notifications have been suppressed yet."
                    : `${history.length} suppressed notification${history.length === 1 ? "" : "s"} recorded.`}
            </Forms.FormText>
            <Button
                onClick={openHistoryModal}
                color={Button.Colors.PRIMARY}
                size={Button.Sizes.SMALL}
            >
                View Suppressed History
            </Button>
        </section>
    );
}
