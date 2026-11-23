/*
 * BestMessageLogger, a Vencord plugin by Kh8da
 * Based on Vencord's MessageLogger (GPL-3.0-or-later, Vendicated and contributors)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./BestMessageLogger.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { updateMessage } from "@api/MessageUpdater";
import { isPluginEnabled } from "@api/PluginManager";
import ErrorBoundary from "@components/ErrorBoundary";
import { EyeIcon, HistoryIcon, LogIcon } from "@components/Icons";
import { getIntlMessage } from "@utils/discord";
import { classes } from "@utils/misc";
import definePlugin from "@utils/types";
import { findCssClassesLazy } from "@webpack";
import { AuthenticationStore, FluxDispatcher, Menu, MessageStore, showToast, Timestamp, useStateFromStores } from "@webpack/common";

import { isEphemeral, shouldIgnore } from "./capture";
import { startCapture, stopCapture } from "./capture-handlers";
import { openHistoryModal } from "./HistoryModal";
import { startMediaCache, stopMediaCache } from "./media-cache";
import { destroyOverlay, openOverlay, setupHotkey, teardownHotkey, toggleOverlay } from "./overlay";
import { settings } from "./settings";
import { clearAll, entries, exportJson, findEntryForMessage, flush, loadLogs, prune, resetLoaded } from "./store";
import { applyDeleteStyle, removeDeleteStyle } from "./styles";
import { logger, parseEditContent } from "./utils";

const VERSION = "3.0.0";
const MessageClasses = findCssClassesLazy("edited", "communicationDisabled", "isSystemMessage");

const BUTTONS_TO_REMOVE = ["edit", "reply", "forward", "thread", "pin", "delete", "mark-unread", "apps", "bookmark", "reminder"];

let pruneTimer: ReturnType<typeof setInterval> | null = null;

function flushOnUnload() {
    void flush();
}

/** Clears a message's history. A deleted message is removed from chat completely. */
function clearMessageHistory(message: any) {
    if (message.deleted) {
        FluxDispatcher.dispatch({ type: "MESSAGE_DELETE", channelId: message.channel_id, id: message.id, mlDeleted: true });
    } else {
        const attachments = message.attachments?.filter((a: any) => !a.deleted);
        updateMessage(message.channel_id, message.id, { editHistory: [], attachments });
    }
}

function hasHistory(message: any): boolean {
    return !!message?.deleted || !!message?.editHistory?.length || !!message?.attachments?.some((a: any) => a.deleted);
}

const patchMessageContextMenu: NavContextMenuPatchCallback = (children, { message }) => {
    if (!message) return;
    const { deleted, id, channel_id } = message as any;
    const entry = findEntryForMessage(id);

    if (!hasHistory(message) && !entry) return;

    if (deleted) {
        for (const buttonId of BUTTONS_TO_REMOVE) {
            const group = findGroupChildrenByChildId(buttonId, children);
            if (group) {
                const index = group.findIndex(c => c?.props?.id === buttonId);
                if (index !== -1) group.splice(index, 1);
            }
        }

        const domElement = document.getElementById(`chat-messages-${channel_id}-${id}`);
        if (domElement) {
            children.push(
                <Menu.MenuItem
                    id="vc-bml-toggle-style"
                    key="vc-bml-toggle-style"
                    label="Toggle Deleted Highlight"
                    leadingAccessory={{ type: "icon", icon: EyeIcon }}
                    action={() => domElement.classList.toggle("messagelogger-deleted")}
                />
            );
        }
    }

    if (entry) {
        children.push(
            <Menu.MenuItem
                id="vc-bml-open-log"
                key="vc-bml-open-log"
                label="Open in Message Log"
                leadingAccessory={{ type: "icon", icon: LogIcon }}
                action={() => openOverlay(entry.key)}
            />
        );
    }

    if (hasHistory(message)) {
        children.push(
            <Menu.MenuItem
                id="vc-bml-remove-history"
                key="vc-bml-remove-history"
                label="Clear Message History"
                color="danger"
                leadingAccessory={{ type: "icon", icon: HistoryIcon }}
                action={() => clearMessageHistory(message)}
            />
        );
    }
};

const patchChannelContextMenu: NavContextMenuPatchCallback = (children, { channel }) => {
    if (!channel?.id) return;
    const messages = MessageStore.getMessages(channel.id) as any;
    if (!messages?.some?.((msg: any) => hasHistory(msg))) return;

    const group = findGroupChildrenByChildId("mark-channel-read", children) ?? children;
    group.push(
        <Menu.MenuItem
            id="vc-bml-clear-channel"
            label="Clear Message Log"
            color="danger"
            action={() => {
                messages.forEach((msg: any) => {
                    if (hasHistory(msg)) clearMessageHistory(msg);
                });
            }}
        />
    );
};

function exposeApi() {
    (window as any).BestMessageLogger = {
        version: VERSION,
        open: () => openOverlay(),
        toggle: toggleOverlay,
        dump: () => entries,
        exportJson,
        clearAll
    };
}

export default definePlugin({
    name: "BestMessageLogger",
    description: "Logs deleted and edited messages and ghost pings, keeps deleted messages in chat even after a restart, saves their media, and gives you a searchable log menu (Ctrl+Shift+I by default).",
    authors: [{ name: "Kh8da", id: 508044811345854495n }],
    dependencies: ["MessageUpdaterAPI"],
    settings,

    contextMenus: {
        "message": patchMessageContextMenu,
        "channel-context": patchChannelContextMenu,
        "thread-context": patchChannelContextMenu,
        "user-context": patchChannelContextMenu,
        "gdm-context": patchChannelContextMenu
    },

    start() {
        if (isPluginEnabled("MessageLogger")) {
            showToast({ text: "Turn off Vencord's MessageLogger: it conflicts with BestMessageLogger.", variant: "critical", duration: 8000 });
        }
        applyDeleteStyle();
        startMediaCache();
        startCapture();
        setupHotkey();
        exposeApi();
        void loadLogs();
        pruneTimer = setInterval(prune, 60 * 60 * 1000);
        window.addEventListener("beforeunload", flushOnUnload);
    },

    stop() {
        stopCapture();
        stopMediaCache();
        teardownHotkey();
        destroyOverlay();
        removeDeleteStyle();
        if (pruneTimer) clearInterval(pruneTimer);
        pruneTimer = null;
        window.removeEventListener("beforeunload", flushOnUnload);
        void flush();
        resetLoaded();
        delete (window as any).BestMessageLogger;
    },

    renderEdits: ErrorBoundary.wrap(({ message: { id: messageId, channel_id: channelId } }: { message: any; }) => {
        const message = useStateFromStores(
            [MessageStore],
            () => MessageStore.getMessage(channelId, messageId) as any,
            null,
            (oldMsg, newMsg) => oldMsg?.editHistory === newMsg?.editHistory
        );

        if (!settings.store.inlineEdits || !message?.editHistory?.length) return null;

        return (
            <>
                {message.editHistory.map((edit: any, idx: number) => (
                    <div key={idx} className="messagelogger-edited">
                        {parseEditContent(edit.content, message)}
                        <Timestamp timestamp={edit.timestamp} isEdited={true} isInline={false}>
                            <span className={MessageClasses.edited}>{" "}({getIntlMessage("MESSAGE_EDITED")})</span>
                        </Timestamp>
                    </div>
                ))}
            </>
        );
    }, { noop: true }),

    makeEdit(newMessage: any, oldMessage: any) {
        return {
            timestamp: new Date(newMessage.edited_timestamp),
            content: oldMessage.content
        };
    },

    shouldIgnore,

    handleUpdateAttachments(newMessage: any) {
        const oldMessage = MessageStore.getMessage(newMessage.channel_id, newMessage.id) as any;
        // no old message means this is a new message, leave it alone
        if (!oldMessage || shouldIgnore(newMessage, true)) return newMessage.attachments;
        if (!newMessage.attachments?.length) {
            return (oldMessage.attachments ?? []).map((a: any) => ({ ...a, deleted: true }));
        }
        return (oldMessage.attachments ?? [])
            .map((old: any) => newMessage.attachments.find((a: any) => a.id === old.id) ?? { ...old, deleted: true })
            .concat(newMessage.attachments.filter((a: any) => !(oldMessage.attachments ?? []).some((o: any) => o.id === a.id)));
    },

    handleDelete(cache: any, data: { ids: string[]; id: string; mlDeleted?: boolean; }, isBulk: boolean) {
        try {
            if (cache == null || (!isBulk && !cache.has(data.id))) return cache;

            const mutate = (id: string) => {
                const msg = cache.get(id);
                if (!msg) return;

                if (data.mlDeleted || isEphemeral(msg) || shouldIgnore(msg)) {
                    cache = cache.remove(id);
                } else {
                    cache = cache.update(id, (m: any) => m
                        .set("deleted", true)
                        .set("attachments", (m.attachments ?? []).map((a: any) => (a.deleted = true, a))));
                }
            };

            if (isBulk) (data.ids ?? []).forEach(mutate);
            else mutate(data.id);
        } catch (e) {
            logger.error("Error during handleDelete", e);
        }
        return cache;
    },

    /**
     * A new message with the nonce of an existing one replaces it in place, which would
     * let people "delete" a message without a delete event. This closes that gap.
     */
    normalizeNonce(msg: any) {
        try {
            if (!msg?.nonce || msg.author?.id === AuthenticationStore.getId()) return;
            const prevMsg = MessageStore.getMessage(msg.channel_id, msg.nonce) as any;
            if (!prevMsg || prevMsg.state !== "SENT") return;
            if (prevMsg.id !== msg.id) delete msg.nonce;
        } catch {
            logger.error("Error normalizing nonce");
        }
    },

    /** "+:emoji:" reactions should target the last message that is not deleted. */
    getReactionTarget(channelId: string) {
        const msgs = (MessageStore.getMessages(channelId) as any)._array ?? [];
        return msgs.findLast((msg: any) => !msg.deleted);
    },

    EditMarker({ message, className, children, ...props }: any) {
        return (
            <span
                {...props}
                className={classes("messagelogger-edit-marker", className)}
                onClick={() => openHistoryModal(message)}
                role="button"
            >
                {children}
            </span>
        );
    },

    DELETED_MESSAGE_COUNT: () => ({
        ast: [[6, "count", { "=0": ["No deleted messages"], one: [[1, "count"], " deleted message"], other: [[1, "count"], " deleted messages"] }, 0, "cardinal"]]
    }),

    // Patches kept in line with Vencord's MessageLogger, so they match the current Discord build
    patches: [
        {
            find: '"MessageStore"',
            replacement: [
                {
                    // Mark deleted messages instead of removing them
                    match: /(?<=MESSAGE_DELETE:function\((\i)\)\{)(?=let.{0,100}(\i\.\i)\.getOrCreate)/,
                    replace: `
                        let cache = $2.getOrCreate($1.channelId);
                        cache = $self.handleDelete(cache, $1, false);
                        $2.commit(cache);
                        return;
                    `
                },
                {
                    match: /(?<=MESSAGE_DELETE_BULK:function\((\i)\){)(?=let.{0,100}(\i\.\i)\.getOrCreate)/,
                    replace: `
                        let cache = $2.getOrCreate($1.channelId);
                        cache = $self.handleDelete(cache, $1, true);
                        $2.commit(cache);
                        return;
                    `
                },
                {
                    // Add the old content and edit time to the message's editHistory
                    match: /(MESSAGE_UPDATE:function\((\i)\).+?)\.update\((\i)/,
                    replace: `
                        $1
                        .update($3, m =>
                            (($2.message.flags & 64) === 64 || $self.shouldIgnore($2.message, true)) ? m :
                            $2.message.edited_timestamp && $2.message.content !== m.content ?
                                m.set('editHistory',[...(m.editHistory || []), $self.makeEdit($2.message, m)]) :
                                m
                        )
                        .update($3
                    `
                },
                {
                    // Up arrow (edit last message) should skip deleted messages
                    match: /(?<=getLastEditableMessage\(\i\)\{.{0,200}\.find\((\i)=>)/,
                    replace: "!$1.deleted &&"
                }
            ]
        },
        {
            // Message model
            find: "}addReaction(",
            replacement: [
                {
                    match: /this\.customRenderedContent=(\i)\.customRenderedContent,/,
                    replace: "this.customRenderedContent = $1.customRenderedContent," +
                        "this.deleted = $1.deleted || false," +
                        "this.editHistory = $1.editHistory || []," +
                        "this.firstEditTimestamp = $1.firstEditTimestamp || this.editedTimestamp || this.timestamp,"
                }
            ]
        },
        {
            // Updated message transformer
            find: ".PREMIUM_REFERRAL&&(",
            replacement: [
                {
                    match: /(?<=null!=\i\.edited_timestamp\)return )\i\(\i,\{reactions:(\i)\.reactions.{0,50}\}\)/,
                    replace: "Object.assign($&,{ deleted:$1.deleted, editHistory:$1.editHistory, firstEditTimestamp:$1.firstEditTimestamp })"
                },
                {
                    match: /attachments:(\i)\.attachments\?\?\[\],/,
                    predicate: () => settings.store.logDeletedAttachments,
                    replace: "attachments: $self.handleUpdateAttachments($1),"
                }
            ]
        },
        {
            // Attachment renderer
            find: "#{intl::REMOVE_ATTACHMENT_TOOLTIP_TEXT}",
            replacement: [
                {
                    match: /\.SPOILER,(?=\[\i\.\i\]:)(?<=item:(\i),.{0,200}?)/,
                    replace: '$&"messagelogger-deleted-attachment": $1?.originalItem?.deleted,'
                },
                {
                    match: /(?<=\{let\{[^}]*?item:(\i),autoPlayGif:\i,)canRemoveItem:(\i)(?=,onRemoveItem:)/,
                    replace: "_canRemoveItem:$2 = arguments[0].canRemoveItem && !$1?.originalItem?.deleted"
                }
            ]
        },
        {
            // Message row
            find: "Message must not be a thread starter message",
            replacement: [
                {
                    match: /\)\("li",\{(.+?),className:/,
                    replace: ")(\"li\",{$1,className:(arguments[0].message.deleted ? \"messagelogger-deleted \" : \"\")+"
                }
            ]
        },
        {
            // Message content: render edit history below it
            find: ".SEND_FAILED,",
            replacement: {
                match: /\]:\i.isUnsupported.{0,20}?,children:\[/,
                replace: "$&arguments[0]?.message?.editHistory?.length>0&&$self.renderEdits(arguments[0]),"
            }
        },
        {
            // Make "(edited)" clickable
            find: "#{intl::MESSAGE_EDITED}",
            replacement: {
                match: /(isInline:!1,children:.{0,50}?)"span",\{(?=className:)/,
                replace: "$1$self.EditMarker,{message:arguments[0].message,"
            }
        },
        {
            // Keep replies to deleted messages readable
            find: '"ReferencedMessageStore"',
            replacement: [
                { match: /(?<=MESSAGE_DELETE:function\(\i\)\{)/, replace: "return;" },
                { match: /(?<=MESSAGE_DELETE_BULK:function\(\i\)\{)/, replace: "return;" }
            ]
        },
        {
            // Message context menu: hide the first section for deleted messages
            find: ".MESSAGE,commandTargetId:",
            replacement: [
                {
                    match: /children:(\[""===.+?\])/,
                    replace: "children:arguments[0].message.deleted?[]:$1"
                }
            ]
        },
        {
            find: "NON_COLLAPSIBLE.has(",
            replacement: {
                match: /if\((\i)\.blocked\)return \i\.\i\.MESSAGE_GROUP_BLOCKED;/,
                replace: '$&else if($1.deleted) return"MESSAGE_GROUP_DELETED";'
            },
            predicate: () => settings.store.collapseDeleted
        },
        {
            find: "#{intl::NEW_MESSAGES_ESTIMATED_WITH_DATE}",
            replacement: [
                {
                    match: /(\i).type===\i\.\i\.MESSAGE_GROUP_BLOCKED\|\|/,
                    replace: '$&$1.type==="MESSAGE_GROUP_DELETED"||'
                },
                {
                    match: /(\i).type===\i\.\i\.MESSAGE_GROUP_BLOCKED\?(\i)=.*?:/,
                    replace: '$&$1.type==="MESSAGE_GROUP_DELETED"?$2=$self.DELETED_MESSAGE_COUNT:'
                }
            ],
            predicate: () => settings.store.collapseDeleted
        },
        {
            find: "this.truncateTop",
            replacement: {
                match: /receiveMessage\((\i)\)\{/,
                replace: "$& $self.normalizeNonce($1);"
            }
        },
        {
            find: "anyScopeRegex(/^\\+:(.+?): *$/)",
            replacement: {
                match: /(?<=anyScopeRegex\(\/\^\\\+:\(\.\+\?\): \*\$\/\),action\(\i,\i\)\{.{10,80}?\i=)\i\.\i\.getMessages\((\i\.id)\)\.last\(\)/,
                replace: "$self.getReactionTarget($1)"
            }
        }
    ]
});
