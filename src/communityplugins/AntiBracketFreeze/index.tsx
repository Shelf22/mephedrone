import { updateMessage } from "@api/MessageUpdater";
import definePlugin from "@utils/types";
import { FluxDispatcher, React } from "@webpack/common";

const COMBINING_TEST = /[̀-ͯ҃-҉᷀-᷿⃐-⃿]{50,}/;

function isDangerous(content: unknown): boolean {
    if (typeof content !== "string" || content.length === 0) return false;
    if (/\[{21,}/.test(content)) return true;
    if (/\|{42,}/.test(content)) return true;
    if (/`{50,}/.test(content)) return true;
    if (COMBINING_TEST.test(content)) return true;
    return false;
}

const sanitizeLog: { type: string; field: string; preview: string; }[] = [];

function log(type: string, field: string, content: string) {
    const entry = { type, field, preview: content.slice(0, 80) };
    sanitizeLog.push(entry);
    console.warn(`[AntiBracketFreeze] Blocked ${type}.${field}:`, entry.preview);
}

function sanitizeStr(obj: any, key: string, label: string) {
    if (!isDangerous(obj?.[key])) return;
    log(label, key, obj[key]);
    obj[key] = "";
}

function patchMessage(msg: any) {
    if (!msg?.id) return;
    if (isDangerous(msg.content)) {
        log("message", "content", msg.content);
        blocked.set(msg.id, { channelId: msg.channel_id, content: msg.content });
        msg.content = "";
    }
}

function patchChannel(ch: any) {
    if (!ch) return;
    sanitizeStr(ch, "topic", "channel");
    sanitizeStr(ch, "name", "channel");
}

function patchGuild(guild: any) {
    if (!guild) return;
    sanitizeStr(guild, "description", "guild");
    sanitizeStr(guild, "name", "guild");
    guild.channels?.forEach?.(patchChannel);
    guild.threads?.forEach?.(patchChannel);
    guild.roles?.forEach?.((r: any) => sanitizeStr(r, "name", "role"));
}

// messageId → { channelId, originalContent }
const blocked = new Map<string, { channelId: string; content: string; }>();
const revealed = new Set<string>();

let origDispatch: Function | null = null;

function patchedDispatch(this: any, action: any) {
    try {
        switch (action?.type) {
            case "MESSAGE_CREATE":
            case "MESSAGE_UPDATE":
                patchMessage(action.message);
                break;
            case "LOAD_MESSAGES_SUCCESS":
                action.messages?.forEach?.(patchMessage);
                break;
            case "GUILD_CREATE":
            case "GUILD_UPDATE":
                patchGuild(action.guild);
                break;
            case "CHANNEL_CREATE":
            case "CHANNEL_UPDATE":
                patchChannel(action.channel);
                break;
            case "CONNECTION_OPEN":
                action.guilds?.forEach?.(patchGuild);
                break;
        }
    } catch (e) {
        console.error("[AntiBracketFreeze] dispatch error:", e);
    }
    return origDispatch!.call(this, action);
}

export default definePlugin({
    name: "AntiBracketFreeze",
    description: "Blocks potentially ReDoS-triggering content at the Flux layer",
    authors: [{ name: "56", id: 1143371348207480892n }],
    dependencies: ["MessageAccessoriesAPI", "MessageUpdaterAPI"],

    start() {
        origDispatch = FluxDispatcher.dispatch.bind(FluxDispatcher);
        FluxDispatcher.dispatch = patchedDispatch as any;
        (window as any).__antiBFLog = sanitizeLog;
    },

    stop() {
        if (origDispatch) {
            FluxDispatcher.dispatch = origDispatch as any;
            origDispatch = null;
        }
        blocked.clear();
        revealed.clear();
    },

    renderMessageAccessory({ message }: any) {
        if (revealed.has(message.id)) {
            const entry = blocked.get(message.id);
            if (!entry) return null;
            return (
                <div style={{
                    background: "var(--background-tertiary)",
                    border: "1px solid var(--status-warning)",
                    borderRadius: "4px",
                    padding: "8px 12px",
                    marginTop: "4px",
                    fontSize: "14px",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-code)",
                }}>
                    {entry.content}
                </div>
            );
        }

        if (!blocked.has(message.id)) return null;

        return (
            <div style={{
                background: "var(--background-tertiary)",
                border: "1px solid var(--status-danger)",
                borderRadius: "4px",
                padding: "8px 12px",
                marginTop: "4px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "14px",
            }}>
                <span style={{ color: "var(--status-danger)", fontWeight: "bold" }}>
                    Potentially dangerous message blocked (possible ReDoS attack)
                </span>
                <button
                    style={{
                        background: "var(--button-danger-background)",
                        color: "white",
                        border: "none",
                        borderRadius: "3px",
                        padding: "2px 10px",
                        cursor: "pointer",
                        fontSize: "13px",
                    }}
                    onClick={() => {
                        const entry = blocked.get(message.id);
                        if (!entry) return;
                        revealed.add(message.id);
                        updateMessage(entry.channelId, message.id);
                    }}
                >
                    Show as plain text
                </button>
            </div>
        );
    },
});
