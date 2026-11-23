import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { React, Toasts, useEffect, useState, useStateFromStores } from "@webpack/common";

const settings = definePluginSettings({
    dynamicGradient: {
        type: OptionType.BOOLEAN,
        description: "Adaptive gradient from game icon",
        default: true
    },
    showElapsed: {
        type: OptionType.BOOLEAN,
        description: "Show playtime",
        default: true
    }
});

const ActivityStore = findStoreLazy("LocalActivityStore") ?? findStoreLazy("ActivityStore");
const RunningGameStore = findStoreLazy("RunningGameStore");
const ChannelRTCStore = findStoreLazy("ChannelRTCStore") ?? findStoreLazy("RTCConnectionStore");
const MediaEngineActions = findByPropsLazy("setGoLiveSource");

const iconCache = new Map<string, string>();
const colorCache = new Map<string, { r: number; g: number; b: number } | null>();

function getDominantColor(url: string, cb: (color: { r: number; g: number; b: number } | null) => void) {
    if (colorCache.has(url)) return cb(colorCache.get(url)!);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
        const cvs = document.createElement("canvas");
        cvs.width = cvs.height = 16;
        const ctx = cvs.getContext("2d");
        if (!ctx) return cb(null);

        ctx.drawImage(img, 0, 0, 16, 16);
        const { data } = ctx.getImageData(0, 0, 16, 16);
        let r = 0, g = 0, b = 0, count = 0;

        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 128) continue;
            const cr = data[i], cg = data[i + 1], cb_ = data[i + 2];
            const lum = 0.299 * cr + 0.587 * cg + 0.114 * cb_;
            if (lum > 25 && lum < 235) {
                r += cr;
                g += cg;
                b += cb_;
                count++;
            }
        }

        const res = count ? { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) } : null;
        colorCache.set(url, res);
        cb(res);
    };
    img.onerror = () => cb(null);
    img.src = url;
}

function GameActivityBox() {
    const { dynamicGradient, showElapsed } = settings.use(["dynamicGradient", "showElapsed"]);

    const game = useStateFromStores([ActivityStore, RunningGameStore], () => {
        const acts = ActivityStore?.getActivities?.() ?? [];
        const act = acts.find(a => a?.type === 0 && a.name && !a.name.toLowerCase().includes("spotify"));
        if (act) return act;

        const running = RunningGameStore?.getRunningGames?.() ?? [];
        if (running.length) {
            return {
                name: running[0].name,
                application_id: running[0].id,
                timestamps: { start: running[0].start }
            };
        }
        return null;
    });

    const [elapsed, setElapsed] = useState("");
    const [iconUrl, setIconUrl] = useState<string | null>(null);
    const [color, setColor] = useState<{ r: number; g: number; b: number } | null>(null);

    useEffect(() => {
        if (!game?.timestamps?.start) {
            setElapsed("");
            return;
        }

        const update = () => {
            const diff = Math.floor((Date.now() - game.timestamps.start) / 1000);
            if (diff < 60) setElapsed("Playing for a few seconds");
            else if (diff < 3600) setElapsed(`Playing for ${Math.floor(diff / 60)}m`);
            else setElapsed(`Playing for ${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`);
        };

        update();
        const timer = setInterval(update, 10000);
        return () => clearInterval(timer);
    }, [game]);

    useEffect(() => {
        if (!game) {
            setIconUrl(null);
            setColor(null);
            return;
        }

        if (game.assets?.large_image) {
            const img = game.assets.large_image;
            const url = img.startsWith("mp:external/")
                ? `https://media.discordapp.net/external/${img.slice(12)}`
                : game.application_id
                    ? `https://cdn.discordapp.com/app-assets/${game.application_id}/${img}.png?size=128`
                    : null;
            if (url) {
                setIconUrl(url);
                if (dynamicGradient) getDominantColor(url, setColor);
                return;
            }
        }

        if (game.application_id && iconCache.has(game.application_id)) {
            const url = iconCache.get(game.application_id)!;
            setIconUrl(url);
            if (dynamicGradient) getDominantColor(url, setColor);
            return;
        }

        if (game.application_id) {
            fetch(`https://discord.com/api/v9/applications/${game.application_id}/rpc`)
                .then(r => r.json())
                .then(data => {
                    if (data?.icon) {
                        const url = `https://cdn.discordapp.com/app-icons/${game.application_id}/${data.icon}.webp?size=128`;
                        iconCache.set(game.application_id, url);
                        setIconUrl(url);
                        if (dynamicGradient) getDominantColor(url, setColor);
                    }
                })
                .catch(() => {});
        }
    }, [game, dynamicGradient]);

    if (!game) return null;

    const stream = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        const btn = document.querySelector<HTMLButtonElement>('button[aria-label*="Share Your Screen" i], button[aria-label*="Screenshare" i]');
        if (btn) {
            btn.click();
            return;
        }

        const channelId = ChannelRTCStore?.getChannelId?.();
        if (!channelId) {
            Toasts.show({
                message: `Join a voice channel first to stream ${game.name}!`,
                id: Toasts.genId(),
                type: Toasts.Type.FAILURE
            });
            return;
        }

        MediaEngineActions?.setGoLiveSource?.(channelId);
    };

    return (
        <div
            className="vc-game-activity-box"
            style={dynamicGradient && color ? {
                "--game-color": `${color.r}, ${color.g}, ${color.b}`
            } as React.CSSProperties : undefined}
        >
            <div className="vc-game-activity-box-left">
                {iconUrl ? (
                    <img src={iconUrl} alt="" className="vc-game-activity-box-icon" />
                ) : (
                    <div className="vc-game-activity-box-icon-placeholder">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M21.57 6.07C21.32 5.43 20.73 5 20.04 5H3.96c-.69 0-1.28.43-1.53 1.07C1.48 8.5 1 11.23 1 14c0 3.31 2.69 6 6 6 1.5 0 2.87-.55 3.93-1.46.36-.31.84-.48 1.32-.48h.48c.48 0 .96.17 1.32.48C15.13 19.45 16.5 20 18 20c3.31 0 6-2.69 6-6 0-2.77-.48-5.5-1.43-7.93zM8 13H7v1c0 .55-.45 1-1 1s-1-.45-1-1v-1H4c-.55 0-1-.45-1-1s.45-1 1-1h1v-1c0-.55.45-1 1-1s1 .45 1 1v1h1c.55 0 1 .45 1 1s-.45 1-1 1zm9.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm2-3c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
                        </svg>
                    </div>
                )}
                <div className="vc-game-activity-box-details">
                    <span className="vc-game-activity-box-name">{game.name}</span>
                    <span className="vc-game-activity-box-status">
                        {showElapsed ? (elapsed || game.details || "Playing a game") : (game.details || "Playing a game")}
                    </span>
                </div>
            </div>

            <button
                className="vc-game-activity-box-stream-btn"
                title={`Stream ${game.name}`}
                aria-label={`Stream ${game.name}`}
                onClick={stream}
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path
                        fillRule="evenodd"
                        clipRule="evenodd"
                        d="M3 4C1.89543 4 1 4.89543 1 6V16C1 17.1046 1.89543 18 3 18H8V20H6C5.44772 20 5 20.4477 5 21C5 21.5523 5.44772 22 6 22H18C18.5523 22 19 21.5523 19 21C19 20.4477 18.5523 20 18 20H16V18H21C22.1046 18 23 17.1046 23 16V6C23 4.89543 22.1046 4 21 4H3ZM3 6H21V16H3V6ZM10 8L15 11L10 14V8Z"
                    />
                </svg>
            </button>
        </div>
    );
}

export default definePlugin({
    name: "OldGameActivityBox",
    description: "⚠️ May be outdated for the current Discord. Restores the old game activity box above the account panel",
    authors: [{ name: "Dhruv", id: 0n }],
    settings,
    patches: [
        {
            find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
            replacement: {
                match: /(?<=\i\.jsxs?\)\()(\i),{(?=[^}]*?userTag:\i,occluded:)/,
                replace: "$self.PanelWrapper,{VencordOriginal:$1,"
            }
        }
    ],
    PanelWrapper({ VencordOriginal, ...props }: any) {
        return (
            <>
                <GameActivityBox />
                <VencordOriginal {...props} />
            </>
        );
    }
});
