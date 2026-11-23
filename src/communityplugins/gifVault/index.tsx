/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Jumble
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Paragraph } from "@components/Paragraph";
import { confirmAction, sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import {
    FluxDispatcher,
    ListScrollerThin,
    MessageActions,
    Modal,
    openMediaModal,
    openModal,
    PendingReplyStore,
    ScrollerThin,
    SearchableSelect,
    SelectedChannelStore,
    showToast,
    TextInput,
    useEffect,
    useMemo,
    useRef,
    UserSettingsActionCreators,
    UserSettingsProtoStore,
    useState,
    useStateFromStores,
} from "@webpack/common";

const author = { name: "Jumble", id: 1135976262234542233n };
const logger = new Logger("GifVault");
const DATA_KEY = "GifVault_library";
const UNFILED = "Unfiled";
const BACKUP_VERSION = 1;
const DEFAULT_OPEN_KEYBIND = "Ctrl+Shift+G";

const settings = definePluginSettings({
    openMenuKeybind: {
        type: OptionType.STRING,
        displayName: "Open menu keybind",
        description: "Keyboard shortcut to open GIF Vault, for example Ctrl+Shift+G.",
        default: DEFAULT_OPEN_KEYBIND,
        isValid: value => typeof value === "string" && !!getKeybindModifiers(value),
    },
});

const TILE_SIZES = {
    small: { label: "Small", minWidth: 202, rowHeight: 222 },
    medium: { label: "Medium", minWidth: 282, rowHeight: 262 },
    large: { label: "Large", minWidth: 380, rowHeight: 310 },
} as const;

type GifTileSize = keyof typeof TILE_SIZES;
type GifSortOrder = "added-oldest" | "added-newest" | "title-asc" | "title-desc";

function isGifSortOrder(value: string): value is GifSortOrder {
    return (
        value === "added-oldest" ||
        value === "added-newest" ||
        value === "title-asc" ||
        value === "title-desc"
    );
}

function getKeybindModifiers(value: string) {
    const parts = value
        .split("+")
        .map(part => part.trim().toLocaleLowerCase())
        .filter(Boolean);
    if (!parts.length) return;

    const modifiers = {
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
    };
    let key: string | undefined;
    for (const part of parts) {
        switch (part) {
            case "ctrl":
            case "control":
                if (modifiers.ctrl) return;
                modifiers.ctrl = true;
                break;
            case "alt":
                if (modifiers.alt) return;
                modifiers.alt = true;
                break;
            case "shift":
                if (modifiers.shift) return;
                modifiers.shift = true;
                break;
            case "meta":
            case "cmd":
            case "command":
                if (modifiers.meta) return;
                modifiers.meta = true;
                break;
            default:
                if (key) return;
                key = part;
        }
    }

    if (!key || ["ctrl", "control", "alt", "shift", "meta", "cmd", "command"].includes(key))
        return;
    return { ...modifiers, key };
}

function onKeydown(event: KeyboardEvent) {
    if (event.repeat || document.querySelector(".vc-gif-vault")) return;
    const { key: pressedKey, ctrlKey, altKey, shiftKey, metaKey, target } = event;
    const keybind = getKeybindModifiers(settings.store.openMenuKeybind);
    if (!keybind) return;
    const { key: configuredKey, ctrl, alt, shift, meta } = keybind;
    if (pressedKey.toLocaleLowerCase() !== configuredKey) return;
    if (
        ctrlKey !== ctrl ||
        altKey !== alt ||
        shiftKey !== shift ||
        metaKey !== meta
    )
        return;

    if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select, [role='textbox']"))
    )
        return;

    event.preventDefault();
    openGifVault();
}

interface FavoriteGif {
    key: string;
    title: string;
    url: string;
    previewUrl: string;
    format: number;
    width?: number;
    height?: number;
    gifSrc?: () => unknown;
}

interface GifLibraryData {
    folders: string[];
    assignments: Record<string, string[]>;
    titleOverrides: Record<string, string>;
    layoutSize: GifTileSize;
}

const EMPTY_LIBRARY: GifLibraryData = {
    folders: [],
    assignments: {},
    titleOverrides: {},
    layoutSize: "small",
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function httpUrl(value: unknown): string | undefined {
    if (typeof value !== "string") return;
    try {
        const url = new URL(value);
        if (url.protocol === "https:" || url.protocol === "http:") return url.href;
    } catch {
        return;
    }
}

function getFavorites(): FavoriteGif[] {
    const favoriteGifs = UserSettingsProtoStore.frecencyWithoutFetchingLatest.favoriteGifs as
        | {
              gifs?: Record<string, unknown>;
          }
        | undefined;
    if (!favoriteGifs?.gifs) return [];

    const favorites = Object.entries(favoriteGifs.gifs).flatMap(([key, value], fallbackOrder) => {
        if (!isRecord(value)) return [];

        const url =
            httpUrl(value.url) ?? httpUrl(value.src) ?? httpUrl(value.gifSrc) ?? httpUrl(key);
        const previewUrl =
            httpUrl(value.src) ?? httpUrl(value.url) ?? httpUrl(value.gifSrc) ?? httpUrl(key);
        if (!url || !previewUrl) return [];

        return [{
            gif: {
                key,
                title:
                    typeof value.title === "string" && value.title
                        ? value.title
                        : typeof value.name === "string" && value.name
                          ? value.name
                          : new URL(url).hostname,
                url,
                previewUrl,
                format: value.format === 2 ? 2 : 1,
                width:
                    typeof value.width === "number" && Number.isFinite(value.width)
                        ? value.width
                        : undefined,
                height:
                    typeof value.height === "number" && Number.isFinite(value.height)
                        ? value.height
                        : undefined,
                gifSrc:
                    typeof value.gifSrc === "function"
                        ? (value.gifSrc as () => unknown)
                        : undefined,
            },
            fallbackOrder,
            order:
                typeof value.order === "number" && Number.isFinite(value.order)
                    ? value.order
                    : undefined,
        }];
    });

    const hasNativeOrder = favorites.every(({ order }) => order !== undefined);
    favorites.sort((a, b) =>
        hasNativeOrder
            ? a.order! - b.order! || a.fallbackOrder - b.fallbackOrder
            : a.fallbackOrder - b.fallbackOrder,
    );
    return favorites.map(({ gif }) => gif);
}

function getNativeFavoriteMap(): Record<string, unknown> {
    const favoriteGifs = UserSettingsProtoStore.frecencyWithoutFetchingLatest.favoriteGifs as
        | {
              gifs?: Record<string, unknown>;
          }
        | undefined;
    return favoriteGifs?.gifs ?? {};
}

async function getGifUrl(gif: FavoriteGif): Promise<string> {
    if (gif.gifSrc) {
        const resolved = httpUrl(await gif.gifSrc());
        if (resolved) return resolved;
    }
    return gif.url;
}

function readLibraryData(value: unknown): GifLibraryData {
    if (!isRecord(value)) return EMPTY_LIBRARY;
    const folders = Array.isArray(value.folders)
        ? value.folders.filter(
              (folder): folder is string => typeof folder === "string" && folder.length > 0,
          )
        : [];
    const assignments: Record<string, string[]> = {};
    if (isRecord(value.assignments)) {
        for (const [key, assignedFolders] of Object.entries(value.assignments)) {
            if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
            const values =
                typeof assignedFolders === "string"
                    ? [assignedFolders]
                    : Array.isArray(assignedFolders)
                      ? assignedFolders.filter(
                            (folder): folder is string => typeof folder === "string",
                        )
                      : [];
            const validFolders = [...new Set(values.filter((folder) => folders.includes(folder)))];
            if (validFolders.length) assignments[key] = validFolders;
        }
    }
    const titleOverrides: Record<string, string> = {};
    if (isRecord(value.titleOverrides)) {
        for (const [key, title] of Object.entries(value.titleOverrides)) {
            if (
                key === "__proto__" ||
                key === "constructor" ||
                key === "prototype" ||
                typeof title !== "string"
            )
                continue;
            const trimmedTitle = title.trim();
            if (trimmedTitle) titleOverrides[key] = trimmedTitle;
        }
    }
    const layoutSize =
        value.layoutSize === "medium" || value.layoutSize === "large" ? value.layoutSize : "small";
    return { folders: [...new Set(folders)], assignments, titleOverrides, layoutSize };
}

function selectedFolderValue(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    if (isRecord(value) && typeof value.value === "string") return value.value;
}

function getSerializableFavoriteMap() {
    const favorites = Object.create(null) as Record<string, Record<string, unknown>>;
    for (const [key, value] of Object.entries(getNativeFavoriteMap())) {
        if (!isRecord(value)) continue;

        const serializable = Object.fromEntries(
            Object.entries(value).filter(
                ([, field]) =>
                    typeof field === "string" ||
                    typeof field === "number" ||
                    typeof field === "boolean" ||
                    field === null,
            ),
        );
        if (httpUrl(value.url) || httpUrl(value.src) || httpUrl(key)) favorites[key] = serializable;
    }
    return favorites;
}

function readBackupFavorites(value: unknown): Record<string, Record<string, unknown>> {
    if (!isRecord(value)) return {};

    const favorites = Object.create(null) as Record<string, Record<string, unknown>>;
    for (const [key, entry] of Object.entries(value)) {
        if (!isRecord(entry)) continue;

        const url = httpUrl(entry.url) ?? httpUrl(entry.src) ?? httpUrl(key);
        if (!url) continue;

        const favorite = Object.fromEntries(
            Object.entries(entry).filter(
                ([, field]) =>
                    typeof field === "string" ||
                    typeof field === "number" ||
                    typeof field === "boolean" ||
                    field === null,
            ),
        );
        favorite.url = httpUrl(entry.url) ?? url;
        favorite.src = httpUrl(entry.src) ?? url;
        favorites[httpUrl(key) ? key : url] = favorite;
    }
    return favorites;
}

async function exportGifVaultBackup() {
    const library = readLibraryData(await DataStore.get<unknown>(DATA_KEY));
    const backup = {
        version: BACKUP_VERSION,
        favoriteGifs: getSerializableFavoriteMap(),
        library,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `gif-vault-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importGifVaultBackup(file: File) {
    const backup = JSON.parse(await file.text()) as unknown;
    if (!isRecord(backup) || backup.version !== BACKUP_VERSION || !isRecord(backup.library))
        throw new Error("This is not a supported GIF Vault backup.");

    const library = readLibraryData(backup.library);
    const importedFavorites = readBackupFavorites(backup.favoriteGifs);
    let addedFavorites = 0;
    if (Object.keys(importedFavorites).length) {
        await UserSettingsActionCreators.FrecencyUserSettingsActionCreators.updateAsync(
            "favoriteGifs",
            (current) => {
                if (!isRecord(current))
                    throw new Error("Discord's favorite GIF settings are unavailable.");
                const gifs = isRecord(current.gifs) ? current.gifs : {};
                current.gifs = gifs;
                for (const [key, favorite] of Object.entries(importedFavorites)) {
                    if (Object.hasOwn(gifs, key)) continue;
                    gifs[key] = favorite;
                    addedFavorites++;
                }
            },
            0,
        );
    }

    await DataStore.set(DATA_KEY, library);
    return addedFavorites;
}

const GifVaultBackupSettings = ErrorBoundary.wrap(
    () => {
        const inputRef = useRef<HTMLInputElement>(null);
        const [busy, setBusy] = useState(false);

        async function exportBackup() {
            setBusy(true);
            try {
                await exportGifVaultBackup();
                showToast({ text: "GIF Vault backup exported.", variant: "success" });
            } catch (error) {
                logger.error("Failed to export GIF Vault backup", error);
                showToast({ text: "Failed to export the GIF Vault backup.", variant: "critical" });
            } finally {
                setBusy(false);
            }
        }

        async function importBackup(input: HTMLInputElement) {
            const file = input.files?.[0];
            input.value = "";
            if (!file) return;

            setBusy(true);
            try {
                const count = await importGifVaultBackup(file);
                showToast({
                    text: `GIF Vault backup imported. Added ${count} favorite GIF${count === 1 ? "" : "s"} where missing.`,
                    variant: "success",
                });
            } catch (error) {
                logger.error("Failed to import GIF Vault backup", error);
                showToast({
                    text: "Failed to import the GIF Vault backup. Check the Vencord console for details.",
                    variant: "critical",
                });
            } finally {
                setBusy(false);
            }
        }

        return (
            <div className="vc-gif-vault-backupSettings">
                <Paragraph>
                    Export a backup of your favorite GIFs and folder organization, or merge one into
                    this Discord account.
                </Paragraph>
                <div className="vc-gif-vault-backupActions">
                    <Button variant="secondary" onClick={exportBackup} disabled={busy}>
                        Export GIF Vault
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={() => inputRef.current?.click()}
                        disabled={busy}
                    >
                        Import GIF Vault
                    </Button>
                    <input
                        ref={inputRef}
                        type="file"
                        accept="application/json,.json"
                        hidden
                        onChange={(event) => void importBackup(event.currentTarget)}
                    />
                </div>
            </div>
        );
    },
    { noop: true },
);

function openGifVault() {
    const channelId = SelectedChannelStore.getChannelId();
    if (!channelId) return;

    openModal((modalProps) => <SafeGifVaultModal channelId={channelId} modalProps={modalProps} />);
}

function GifPreview({
    gif,
    compact = false,
    resolveGifSrc = false,
}: {
    gif: FavoriteGif;
    compact?: boolean;
    resolveGifSrc?: boolean;
}) {
    const [imageUrl, setImageUrl] = useState(gif.previewUrl);

    useEffect(() => {
        let cancelled = false;
        setImageUrl(gif.previewUrl);
        if (!resolveGifSrc || !gif.gifSrc) return;

        Promise.resolve()
            .then(() => gif.gifSrc!())
            .then((value) => {
                const url = httpUrl(value);
                if (!cancelled && url) setImageUrl(url);
            })
            .catch((error) => logger.error("Failed to resolve a favorite GIF preview", error));

        return () => {
            cancelled = true;
        };
    }, [gif, resolveGifSrc]);

    return (
        <img
            className={
                compact
                    ? "vc-gif-vault-preview vc-gif-vault-previewCompact"
                    : "vc-gif-vault-preview"
            }
            src={imageUrl}
            alt={gif.title}
            loading="lazy"
        />
    );
}

function GifVaultCard({
    gif,
    assignedFolders,
    folders,
    selected,
    saving,
    editing,
    titleDraft,
    onPreview,
    onToggleFolder,
    onTitleDraftChange,
    onStartRename,
    onSaveRename,
    onCancelRename,
    onDelete,
}: {
    gif: FavoriteGif;
    assignedFolders: string[];
    folders: string[];
    selected: boolean;
    saving: boolean;
    editing: boolean;
    titleDraft: string;
    onPreview(): void;
    onToggleFolder(folder: string): void;
    onTitleDraftChange(value: string): void;
    onStartRename(): void;
    onSaveRename(): void;
    onCancelRename(): void;
    onDelete(): void;
}) {
    return (
        <article className="vc-gif-vault-card">
            <button
                type="button"
                className={`vc-gif-vault-cardPreview${selected ? " vc-gif-vault-cardSelected" : ""}`}
                onClick={onPreview}
                aria-label={`Preview ${gif.title} above`}
                aria-pressed={selected}
            >
                <GifPreview gif={gif} compact />
            </button>
            <div className="vc-gif-vault-cardTitleRow">
                {editing ? (
                    <>
                        <TextInput
                            value={titleDraft}
                            onChange={onTitleDraftChange}
                            placeholder="GIF title"
                            maxLength={100}
                            inputClassName="vc-gif-vault-titleInput"
                        />
                        <button
                            type="button"
                            className="vc-gif-vault-cardAction"
                            aria-label={`Save ${gif.title} title`}
                            title="Save title"
                            onClick={onSaveRename}
                            disabled={!titleDraft.trim() || saving}
                        >
                            ✓
                        </button>
                        <button
                            type="button"
                            className="vc-gif-vault-cardAction"
                            aria-label="Cancel GIF rename"
                            title="Cancel"
                            onClick={onCancelRename}
                            disabled={saving}
                        >
                            ×
                        </button>
                    </>
                ) : (
                    <>
                        <span className="vc-gif-vault-cardTitle" title={gif.title}>
                            {gif.title}
                        </span>
                        <button
                            type="button"
                            className="vc-gif-vault-cardAction"
                            aria-label={`Rename ${gif.title}`}
                            title={`Rename ${gif.title}`}
                            onClick={onStartRename}
                            disabled={saving}
                        >
                            ✎
                        </button>
                        <button
                            type="button"
                            className="vc-gif-vault-cardAction vc-gif-vault-cardDelete"
                            aria-label={`Remove ${gif.title} from favorites`}
                            title="Remove from favorites"
                            onClick={onDelete}
                            disabled={saving}
                        >
                            ×
                        </button>
                    </>
                )}
            </div>
            <div
                className="vc-gif-vault-folderSelectWrapper"
                title={assignedFolders.length ? assignedFolders.join(", ") : UNFILED}
            >
                <SearchableSelect
                    className="vc-gif-vault-folderSelect"
                    placeholder={assignedFolders.length ? assignedFolders.join(", ") : UNFILED}
                    options={[
                        { label: UNFILED, value: "" },
                        ...folders.map((folder) => ({
                            label: folder,
                            value: folder,
                        })),
                    ]}
                    value={null}
                    onChange={(value) => {
                        const folder = selectedFolderValue(value);
                        if (folder !== undefined) onToggleFolder(folder);
                    }}
                    renderOptionPrefix={(option) =>
                        assignedFolders.includes(option.value) ? (
                            <span className="vc-gif-vault-folderOptionSelected">✓</span>
                        ) : null
                    }
                    closeOnSelect
                    isDisabled={saving}
                    maxVisibleItems={6}
                />
            </div>
        </article>
    );
}

function GifVaultModal({
    channelId,
    modalProps,
}: {
    channelId: string;
    modalProps: RenderModalProps;
}) {
    const favoriteGifs = useStateFromStores([UserSettingsProtoStore], getFavorites);
    const pendingReply = useStateFromStores(
        [PendingReplyStore],
        () => PendingReplyStore.getPendingReply(channelId),
    );
    const [library, setLibrary] = useState<GifLibraryData>(EMPTY_LIBRARY);
    const [loaded, setLoaded] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [search, setSearch] = useState("");
    const [folderFilter, setFolderFilter] = useState("");
    const [sortOrder, setSortOrder] = useState<GifSortOrder>("added-newest");
    const [maximized, setMaximized] = useState(false);
    const [newFolder, setNewFolder] = useState("");
    const [editingFolder, setEditingFolder] = useState<string>();
    const [folderNameDraft, setFolderNameDraft] = useState("");
    const [editingGifKey, setEditingGifKey] = useState<string>();
    const [gifTitleDraft, setGifTitleDraft] = useState("");
    const [randomGif, setRandomGif] = useState<FavoriteGif>();
    const [saving, setSaving] = useState(false);
    const [columns, setColumns] = useState(5);
    const [gridHeight, setGridHeight] = useState(0);
    const gridRef = useRef<HTMLDivElement>(null);
    const vaultRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!maximized) return;

        const modalContent = vaultRef.current?.parentElement;
        if (!modalContent) return;

        const maxWidth = window.innerWidth * 0.95;
        const maxHeight = window.innerHeight * 0.95;
        const originalStyles = new Map<
            HTMLElement,
            Map<string, { value: string; priority: string }>
        >();
        for (
            let element: HTMLElement | null = modalContent;
            element && element !== document.body;
            element = element.parentElement
        ) {
            const bounds = element.getBoundingClientRect();
            const resizeWidth = bounds.width < maxWidth;
            const resizeHeight = bounds.height < maxHeight;
            if (!resizeWidth && !resizeHeight) continue;

            const properties = [
                ...(resizeWidth ? ["width", "max-width"] : []),
                ...(resizeHeight ? ["height", "max-height"] : []),
            ];
            originalStyles.set(
                element,
                new Map(
                    properties.map(property => [
                        property,
                        {
                            value: element.style.getPropertyValue(property),
                            priority: element.style.getPropertyPriority(property),
                        },
                    ]),
                ),
            );
            if (resizeWidth) {
                element.style.setProperty("width", "95vw", "important");
                element.style.setProperty("max-width", "95vw", "important");
            }
            if (resizeHeight) {
                element.style.setProperty("height", "95vh", "important");
                element.style.setProperty("max-height", "95vh", "important");
            }
        }

        return () => {
            for (const [element, styles] of originalStyles) {
                for (const [property, { value, priority }] of styles) {
                    if (value) element.style.setProperty(property, value, priority);
                    else element.style.removeProperty(property);
                }
            }
        };
    }, [maximized]);

    useEffect(() => {
        let cancelled = false;
        DataStore.get<unknown>(DATA_KEY)
            .then((value) => {
                if (cancelled) return;
                setLibrary(readLibraryData(value));
                setLoaded(true);
            })
            .catch((error) => {
                logger.error("Failed to load GIF folder data", error);
                if (cancelled) return;
                setLoadError(true);
                setLoaded(true);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (favoriteGifs.length === 0) {
            setRandomGif(undefined);
        } else if (!randomGif || !favoriteGifs.some((gif) => gif.key === randomGif.key)) {
            setRandomGif(favoriteGifs[Math.floor(Math.random() * favoriteGifs.length)]);
        }
    }, [favoriteGifs, randomGif]);

    const titledGifs = useMemo(
        () =>
            favoriteGifs.map((gif) => ({
                ...gif,
                title: library.titleOverrides[gif.key] ?? gif.title,
            })),
        [favoriteGifs, library.titleOverrides],
    );
    const filteredGifs = useMemo(() => {
        const query = search.trim().toLocaleLowerCase();
        const filtered = titledGifs.filter((gif) => {
            const assignedFolders = library.assignments[gif.key] ?? [];
            const matchesFolder =
                !folderFilter ||
                (folderFilter === UNFILED
                    ? assignedFolders.length === 0
                    : assignedFolders.includes(folderFilter));
            const matchesSearch =
                !query || `${gif.title} ${gif.url}`.toLocaleLowerCase().includes(query);
            return matchesFolder && matchesSearch;
        });
        if (sortOrder === "added-newest") return filtered.reverse();
        if (sortOrder === "added-oldest") return filtered;

        return filtered.sort((a, b) =>
            sortOrder === "title-asc"
                ? a.title.localeCompare(b.title, undefined, {
                      numeric: true,
                      sensitivity: "base",
                  })
                : b.title.localeCompare(a.title, undefined, {
                      numeric: true,
                      sensitivity: "base",
                  }),
        );
    }, [folderFilter, library.assignments, search, sortOrder, titledGifs]);
    const gifRows = useMemo(() => {
        const rows: FavoriteGif[][] = [];
        for (let i = 0; i < filteredGifs.length; i += columns)
            rows.push(filteredGifs.slice(i, i + columns));
        return rows;
    }, [columns, filteredGifs]);
    const folderCounts = useMemo(() => {
        const counts = new Map<string, number>([[UNFILED, 0]]);
        for (const gif of favoriteGifs) {
            const folders = library.assignments[gif.key] ?? [];
            if (!folders.length) counts.set(UNFILED, (counts.get(UNFILED) ?? 0) + 1);
            else {
                for (const folder of folders) counts.set(folder, (counts.get(folder) ?? 0) + 1);
            }
        }
        return counts;
    }, [favoriteGifs, library.assignments]);
    const tileSize = TILE_SIZES[library.layoutSize];

    useEffect(() => {
        const node = gridRef.current;
        if (!node) return;

        const observer = new ResizeObserver(() => {
            const nextHeight = node.clientHeight;
            setGridHeight(current => (current === nextHeight ? current : nextHeight));

            const nextColumns =
                library.layoutSize === "large" && !maximized
                    ? 2
                    : Math.max(
                          1,
                          Math.min(
                              5,
                              Math.floor(
                                  (node.clientWidth + 12) /
                                      (tileSize.minWidth * (maximized ? 1.5 : 1) + 12),
                              ),
                          ),
                      );
            setColumns((current) => (current === nextColumns ? current : nextColumns));
        });
        observer.observe(node);

        return () => observer.disconnect();
    }, [loaded, filteredGifs.length > 0, library.layoutSize, maximized]);
    const rowHeight = maximized
        ? Math.min(tileSize.rowHeight * 1.5, gridHeight || tileSize.rowHeight * 1.5)
        : tileSize.rowHeight;

    async function saveLibrary(next: GifLibraryData) {
        setSaving(true);
        try {
            await DataStore.set(DATA_KEY, next);
            setLibrary(next);
        } catch (error) {
            logger.error("Failed to save GIF Vault library data", error);
            setLoadError(true);
        } finally {
            setSaving(false);
        }
    }

    function rollRandom() {
        if (favoriteGifs.length === 0) return;
        const candidates =
            favoriteGifs.length > 1 && randomGif
                ? favoriteGifs.filter((gif) => gif.key !== randomGif.key)
                : favoriteGifs;
        setRandomGif(candidates[Math.floor(Math.random() * candidates.length)]);
    }

    async function sendRandomGif() {
        if (!randomGif) return;
        try {
            const reply = PendingReplyStore.getPendingReply(channelId);
            await sendMessage(
                channelId,
                { content: await getGifUrl(randomGif) },
                false,
                MessageActions.getSendMessageOptionsForReply(reply),
            );
            if (reply) FluxDispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId });
            modalProps.onClose();
        } catch (error) {
            logger.error("Failed to send a favorite GIF", error);
            showToast({
                text: "Failed to send the GIF. Check the Vencord console for details.",
                variant: "critical",
            });
        }
    }

    async function openFullscreenPreview(gif: FavoriteGif) {
        try {
            const url = await getGifUrl(gif);
            openMediaModal({
                items: [
                    {
                        type: gif.format === 2 ? "VIDEO" : "IMAGE",
                        url,
                        original: url,
                        alt: gif.title,
                        width: gif.width ?? 800,
                        height: gif.height ?? 600,
                        animated: gif.format === 2,
                    },
                ],
            });
        } catch (error) {
            logger.error("Failed to open a favorite GIF preview", error);
            showToast({
                text: "Failed to open the GIF preview. Check the Vencord console for details.",
                variant: "critical",
            });
        }
    }

    function assignFolders(gifKey: string, folders: string[]) {
        const assignments = { ...library.assignments };
        const uniqueFolders = [
            ...new Set(folders.filter((folder) => library.folders.includes(folder))),
        ];
        if (uniqueFolders.length) assignments[gifKey] = uniqueFolders;
        else delete assignments[gifKey];
        void saveLibrary({ ...library, assignments });
    }

    function saveGifTitle(gifKey: string) {
        const title = gifTitleDraft.trim();
        if (!title) return;

        const originalTitle = favoriteGifs.find((gif) => gif.key === gifKey)?.title;
        const titleOverrides = { ...library.titleOverrides };
        if (title === originalTitle) delete titleOverrides[gifKey];
        else titleOverrides[gifKey] = title;

        void saveLibrary({ ...library, titleOverrides });
        setEditingGifKey(undefined);
        setGifTitleDraft("");
    }

    async function removeFavorite(gif: FavoriteGif) {
        setSaving(true);
        try {
            await UserSettingsActionCreators.FrecencyUserSettingsActionCreators.updateAsync(
                "favoriteGifs",
                (current) => {
                    if (!isRecord(current) || !isRecord(current.gifs))
                        throw new Error("Discord's favorite GIF settings are unavailable.");
                    delete current.gifs[gif.key];
                },
                0,
            );
        } catch (error) {
            logger.error("Failed to remove a favorite GIF", error);
            showToast({
                text: "Failed to remove the GIF from favorites. Check the Vencord console for details.",
                variant: "critical",
            });
            setSaving(false);
            return;
        }

        const assignments = { ...library.assignments };
        const titleOverrides = { ...library.titleOverrides };
        delete assignments[gif.key];
        delete titleOverrides[gif.key];
        const nextLibrary = { ...library, assignments, titleOverrides };
        try {
            await DataStore.set(DATA_KEY, nextLibrary);
            setLibrary(nextLibrary);
            showToast({ text: "GIF removed from favorites.", variant: "success" });
        } catch (error) {
            logger.error("Removed a favorite GIF but failed to clear its GIF Vault metadata", error);
            setLoadError(true);
            showToast({
                text: "The GIF was removed from favorites, but its GIF Vault data could not be cleared.",
                variant: "critical",
            });
        } finally {
            setSaving(false);
            if (editingGifKey === gif.key) {
                setEditingGifKey(undefined);
                setGifTitleDraft("");
            }
        }
    }

    function confirmRemoveFavorite(gif: FavoriteGif) {
        void confirmAction({
            title: `Remove ${gif.title} from favorites?`,
            subtitle: "This removes the GIF from your Discord favorites and cannot be undone here.",
            confirmText: "Remove favorite",
            onConfirm: () => removeFavorite(gif),
        }).catch((error) => {
            logger.error("Failed to confirm favorite GIF removal", error);
            showToast({
                text: "Failed to remove the GIF from favorites. Check the Vencord console for details.",
                variant: "critical",
            });
        });
    }

    function createFolder() {
        const name = newFolder.trim();
        if (
            !name ||
            name.toLocaleLowerCase() === UNFILED.toLocaleLowerCase() ||
            library.folders.some(
                (folder) => folder.toLocaleLowerCase() === name.toLocaleLowerCase(),
            )
        )
            return;
        void saveLibrary({ ...library, folders: [...library.folders, name] });
        setNewFolder("");
    }

    function deleteFolder(name: string) {
        const assignments: Record<string, string[]> = {};
        for (const [gifKey, folders] of Object.entries(library.assignments)) {
            const remaining = folders.filter((folder) => folder !== name);
            if (remaining.length) assignments[gifKey] = remaining;
        }
        void saveLibrary({
            ...library,
            folders: library.folders.filter((folder) => folder !== name),
            assignments,
        });
        if (folderFilter === name) setFolderFilter("");
    }

    function beginRenameFolder(name: string) {
        setEditingFolder(name);
        setFolderNameDraft(name);
    }

    function renameFolder(oldName: string) {
        const newName = folderNameDraft.trim();
        if (
            !newName ||
            newName.toLocaleLowerCase() === UNFILED.toLocaleLowerCase() ||
            library.folders.some(
                (folder) =>
                    folder !== oldName &&
                    folder.toLocaleLowerCase() === newName.toLocaleLowerCase(),
            )
        )
            return;

        const assignments = Object.fromEntries(
            Object.entries(library.assignments).map(([gifKey, folders]) => [
                gifKey,
                folders.map((folder) => (folder === oldName ? newName : folder)),
            ]),
        );
        void saveLibrary({
            ...library,
            folders: library.folders.map((folder) => (folder === oldName ? newName : folder)),
            assignments,
        });
        if (folderFilter === oldName) setFolderFilter(newName);
        setEditingFolder(undefined);
        setFolderNameDraft("");
    }

    const newFolderName = newFolder.trim().toLocaleLowerCase();
    const canCreateFolder =
        newFolderName &&
        newFolderName !== UNFILED.toLocaleLowerCase() &&
        !library.folders.some((folder) => folder.toLocaleLowerCase() === newFolderName);
    const canRenameFolder =
        folderNameDraft.trim() &&
        folderNameDraft.trim().toLocaleLowerCase() !== UNFILED.toLocaleLowerCase() &&
        !library.folders.some(
            (folder) =>
                folder !== editingFolder &&
                folder.toLocaleLowerCase() === folderNameDraft.trim().toLocaleLowerCase(),
        );
    const chunkSize = Math.max(1, Math.ceil(18 / columns));
    const randomDisplayGif = randomGif
        ? (titledGifs.find((gif) => gif.key === randomGif.key) ?? randomGif)
        : undefined;
    return (
        <Modal
            {...modalProps}
            title={
                <div className="vc-gif-vault-modalTitle">
                    <span>GIF Vault</span>
                    <button
                        type="button"
                        className="vc-gif-vault-maximizeButton"
                        aria-label={maximized ? "Restore GIF Vault size" : "Maximize GIF Vault"}
                        aria-pressed={maximized}
                        onClick={() => setMaximized(value => !value)}
                    >
                        {maximized ? "Restore" : "Maximize"}
                    </button>
                </div>
            }
            size={maximized ? "xxl" : "xl"}
            actions={[{ text: "Done", variant: "secondary", onClick: modalProps.onClose }]}
        >
            <div
                ref={vaultRef}
                className={`vc-gif-vault vc-gif-vault-${library.layoutSize}${maximized ? " vc-gif-vault-maximized" : ""}`}
            >
                {loadError && (
                    <div className="vc-gif-vault-notice" role="alert">
                        Some GIF Vault data could not be loaded or saved. Check the Vencord console
                        for details.
                    </div>
                )}

                <section className="vc-gif-vault-random">
                    <div className="vc-gif-vault-randomPreview">
                        {randomDisplayGif ? (
                            <button
                                type="button"
                                className="vc-gif-vault-fullscreenPreview"
                                aria-label={`View ${randomDisplayGif.title} fullscreen`}
                                title="View fullscreen"
                                onClick={() => void openFullscreenPreview(randomDisplayGif)}
                            >
                                <GifPreview
                                    gif={randomDisplayGif}
                                    resolveGifSrc
                                />
                            </button>
                        ) : (
                            <div className="vc-gif-vault-previewPlaceholder" aria-hidden="true">
                                GIF
                            </div>
                        )}
                        <div className="vc-gif-vault-randomInfo">
                            <h3>Random GIF</h3>
                            {randomDisplayGif ? (
                                <>
                                    <strong>{randomDisplayGif.title}</strong>
                                    <span className="vc-gif-vault-folderLabel">
                                        {library.assignments[randomDisplayGif.key]?.join(", ") ||
                                            UNFILED}
                                    </span>
                                </>
                            ) : (
                                <span className="vc-gif-vault-empty">
                                    {favoriteGifs.length
                                        ? "Pick a favorite to preview."
                                        : "Favorite some GIFs in Discord to get started."}
                                </span>
                            )}
                            <div className="vc-gif-vault-actions">
                                <Button
                                    variant="secondary"
                                    onClick={rollRandom}
                                    disabled={!favoriteGifs.length}
                                >
                                    {randomDisplayGif ? "Reroll" : "Pick a favorite"}
                                </Button>
                                <Button
                                    variant="primary"
                                    onClick={sendRandomGif}
                                    disabled={!randomGif}
                                >
                                    {pendingReply ? "Send as reply" : "Send to chat"}
                                </Button>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="vc-gif-vault-library">
                    <div className="vc-gif-vault-libraryHeading">
                        <div>
                            <h3>Your favorites</h3>
                            <span>
                                {favoriteGifs.length} GIF{favoriteGifs.length === 1 ? "" : "s"}{" "}
                                saved in Discord
                            </span>
                        </div>
                        <div className="vc-gif-vault-libraryActions">
                            <div
                                className="vc-gif-vault-layoutOptions"
                                role="group"
                                aria-label="GIF tile size"
                            >
                                {(Object.keys(TILE_SIZES) as GifTileSize[]).map((size) => (
                                    <button
                                        key={size}
                                        type="button"
                                        className={
                                            library.layoutSize === size
                                                ? "vc-gif-vault-layoutSelected"
                                                : ""
                                        }
                                        aria-pressed={library.layoutSize === size}
                                        title={`${TILE_SIZES[size].label} GIF tiles`}
                                        onClick={() =>
                                            void saveLibrary({ ...library, layoutSize: size })
                                        }
                                        disabled={saving}
                                    >
                                        {TILE_SIZES[size].label}
                                    </button>
                                ))}
                            </div>
                            <div className="vc-gif-vault-createFolder">
                                <TextInput
                                    value={newFolder}
                                    onChange={setNewFolder}
                                    placeholder="New folder name"
                                    maxLength={32}
                                />
                                <Button
                                    variant="secondary"
                                    onClick={createFolder}
                                    disabled={!canCreateFolder || saving}
                                >
                                    Add folder
                                </Button>
                            </div>
                        </div>
                    </div>
                    <div className="vc-gif-vault-libraryTools">
                        <TextInput
                            value={search}
                            onChange={setSearch}
                            placeholder="Search by title or source"
                            aria-label="Search favorite GIFs"
                        />
                        <div className="vc-gif-vault-sortWrapper">
                            <SearchableSelect
                                className="vc-gif-vault-sort"
                                value={sortOrder}
                                placeholder="Sort favorites"
                                options={[
                                    { label: "Newest added", value: "added-newest" },
                                    { label: "Oldest added", value: "added-oldest" },
                                    { label: "Title A–Z", value: "title-asc" },
                                    { label: "Title Z–A", value: "title-desc" },
                                ]}
                                onChange={value => {
                                    if (typeof value === "string" && isGifSortOrder(value))
                                        setSortOrder(value);
                                }}
                                closeOnSelect
                                maxVisibleItems={4}
                            />
                        </div>
                        <span className="vc-gif-vault-count">
                            {filteredGifs.length} GIF{filteredGifs.length === 1 ? "" : "s"}
                        </span>
                    </div>
                    <ScrollerThin
                        className="vc-gif-vault-folderTabs"
                        orientation="horizontal"
                        fade={false}
                    >
                        <div
                            className="vc-gif-vault-folderTabList"
                            aria-label="Filter GIFs by folder"
                        >
                            {[
                                { label: "All", value: "", count: favoriteGifs.length },
                                {
                                    label: UNFILED,
                                    value: UNFILED,
                                    count: folderCounts.get(UNFILED) ?? 0,
                                },
                                ...library.folders.map((folder) => ({
                                    label: folder,
                                    value: folder,
                                    count: folderCounts.get(folder) ?? 0,
                                })),
                            ].map((folder) => (
                                <div
                                    key={folder.value || "all"}
                                    className={`vc-gif-vault-folderTab${folderFilter === folder.value ? " vc-gif-vault-folderTabSelected" : ""}`}
                                >
                                    <button
                                        type="button"
                                        onClick={() => setFolderFilter(folder.value)}
                                        aria-pressed={folderFilter === folder.value}
                                        title={`Show ${folder.label} GIFs`}
                                    >
                                        <span>{folder.label}</span>
                                        <span className="vc-gif-vault-folderCount">
                                            {folder.count}
                                        </span>
                                    </button>
                                    {library.folders.includes(folder.value) &&
                                        (editingFolder === folder.value ? (
                                            <>
                                                <TextInput
                                                    value={folderNameDraft}
                                                    onChange={setFolderNameDraft}
                                                    placeholder="Folder name"
                                                    maxLength={32}
                                                    inputClassName="vc-gif-vault-renameInput"
                                                />
                                                <button
                                                    type="button"
                                                    className="vc-gif-vault-folderAction"
                                                    aria-label={`Save ${folder.label} folder name`}
                                                    onClick={() => renameFolder(folder.value)}
                                                    disabled={!canRenameFolder || saving}
                                                >
                                                    ✓
                                                </button>
                                                <button
                                                    type="button"
                                                    className="vc-gif-vault-folderAction"
                                                    aria-label="Cancel folder rename"
                                                    onClick={() => setEditingFolder(undefined)}
                                                    disabled={saving}
                                                >
                                                    ×
                                                </button>
                                            </>
                                        ) : (
                                            <button
                                                type="button"
                                                className="vc-gif-vault-folderAction"
                                                aria-label={`Rename ${folder.label} folder`}
                                                title={`Rename ${folder.label}`}
                                                onClick={() => beginRenameFolder(folder.value)}
                                                disabled={saving}
                                            >
                                                ✎
                                            </button>
                                        ))}
                                    {library.folders.includes(folder.value) && (
                                        <button
                                            type="button"
                                            className="vc-gif-vault-deleteFolder"
                                            aria-label={`Delete ${folder.label} folder`}
                                            title={`Delete ${folder.label} folder`}
                                            onClick={() => deleteFolder(folder.value)}
                                            disabled={saving}
                                        >
                                            ×
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </ScrollerThin>

                    {!loaded ? (
                        <p className="vc-gif-vault-empty">Loading your GIF folders…</p>
                    ) : filteredGifs.length ? (
                        <div className="vc-gif-vault-gridScroller" ref={gridRef}>
                            <ListScrollerThin
                                key={sortOrder}
                                className="vc-gif-vault-gridScrollerInner"
                                innerClassName="vc-gif-vault-gridContent"
                                sections={[gifRows.length]}
                                sectionHeight={0}
                                rowHeight={rowHeight}
                                chunkSize={chunkSize}
                                paddingTop={0}
                                paddingBottom={0}
                                style={{ overflowAnchor: "none" }}
                                getAnchorId={({ section, row }) => `${section}:${row}`}
                                renderSection={() => null}
                                renderRow={({ row }) => (
                                    <div
                                        key={`gif-row-${row}`}
                                        className="vc-gif-vault-gridRow"
                                        style={{
                                            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                                            height: maximized ? rowHeight : undefined,
                                        }}
                                    >
                                        {gifRows[row].map((gif) => (
                                            <GifVaultCard
                                                key={gif.key}
                                                gif={gif}
                                                assignedFolders={library.assignments[gif.key] ?? []}
                                                folders={library.folders}
                                                selected={randomGif?.key === gif.key}
                                                saving={saving}
                                                editing={editingGifKey === gif.key}
                                                titleDraft={gifTitleDraft}
                                                onPreview={() => setRandomGif(gif)}
                                                onToggleFolder={(folder) => {
                                                    const assigned =
                                                        library.assignments[gif.key] ?? [];
                                                    assignFolders(
                                                        gif.key,
                                                        folder === ""
                                                            ? []
                                                            : assigned.includes(folder)
                                                              ? assigned.filter(
                                                                    (name) => name !== folder,
                                                                )
                                                              : [...assigned, folder],
                                                    );
                                                }}
                                                onTitleDraftChange={setGifTitleDraft}
                                                onStartRename={() => {
                                                    setEditingGifKey(gif.key);
                                                    setGifTitleDraft(gif.title);
                                                }}
                                                onSaveRename={() => saveGifTitle(gif.key)}
                                                onCancelRename={() => {
                                                    setEditingGifKey(undefined);
                                                    setGifTitleDraft("");
                                                }}
                                                onDelete={() => confirmRemoveFavorite(gif)}
                                            />
                                        ))}
                                    </div>
                                )}
                            />
                        </div>
                    ) : (
                        <p className="vc-gif-vault-empty">
                            {favoriteGifs.length
                                ? "No favorites match these filters."
                                : "Your Discord GIF favorites will appear here."}
                        </p>
                    )}
                </section>
            </div>
        </Modal>
    );
}

const SafeGifVaultModal = ErrorBoundary.wrap(
    (props: { channelId: string; modalProps: RenderModalProps }) => <GifVaultModal {...props} />,
    { noop: false },
);

export default definePlugin({
    name: "GifVault",
    description:
        "Organize favorite GIFs into folders, search them, and preview random favorites before posting.",
    authors: [author],
    settings,
    settingsAboutComponent: GifVaultBackupSettings,

    start() {
        document.addEventListener("keydown", onKeydown);
    },

    stop() {
        document.removeEventListener("keydown", onKeydown);
    },

    patches: [
        {
            find: "renderHeaderContent(){",
            replacement: {
                match: /children:\[(\i),this\.renderHeaderContent\(\)\]/,
                replace:
                    'children:[$1,this.renderHeaderContent(),this.state&&this.state.resultType==="Favorites"?$self.GifVaultButton():null]',
            },
        },
    ],

    GifVaultButton: ErrorBoundary.wrap(
        () => (
            <Button
                className="vc-gif-vault-pickerButton"
                variant="secondary"
                size="small"
                onClick={openGifVault}
            >
                Organize favorites
            </Button>
        ),
        { noop: true },
    ),
});
