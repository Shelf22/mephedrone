/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Link safety: IP loggers, Discord/Steam lookalike phishing, QR-login (remote auth) scams, tracking params.

export type LinkVerdict = { kind: "iplogger" | "phishing" | "qrlogin"; host: string; why: string; } | null;

// Grabify / IPLogger and their many disguise domains (public lists)
const IP_LOGGERS = new Set([
    "grabify.link", "grabify.icu", "grabify.org", "iplogger.org", "iplogger.com", "iplogger.ru", "iplogger.co", "iplogger.info",
    "iplogger.cn", "2no.co", "yip.su", "iplis.ru", "ezstat.ru", "blasze.com", "blasze.tk", "ps3cfw.com", "lovebird.guru",
    "trulove.guru", "dateing.club", "otherhalf.life", "shrekis.life", "datasig.io", "datauth.io", "headshot.monster",
    "gaming-at-my.best", "progaming.monster", "yourmy.monster", "screenshare.host", "imageshare.best", "screenshot.best",
    "gamingfun.me", "catsnthing.com", "catsnthings.fun", "curiouscat.club", "joinmy.site", "fortnitechat.site",
    "fortnight.space", "freegiftcards.co", "stopify.co", "leancoding.co", "bmwforum.co", "crabrave.pw", "minecraftfan.club",
    "spottyfly.com", "ipgrabber.ru", "ipgraber.ru", "iplogger.click", "wl.gl", "bit-tracker.com", "grabify.world",
    "canarytokens.com", "canarytokens.org", "webresolver.nl", "iplocation.wtf",
]);

const DISCORD_OFFICIAL = /(^|\.)(discord\.(com|gg|gift|media|new|dev|co|design|store|tools|events)|discordapp\.(com|net)|discordstatus\.com|discord-activities\.com|dis\.gd|discordmerch\.com|discordpartygames\.com)$/;
const STEAM_OFFICIAL = /(^|\.)(steamcommunity\.com|steampowered\.com|steamstatic\.com|steamgames\.com|steamusercontent\.com|steamchina\.com|valvesoftware\.com|steam\.tv|steamdeck\.com)$/;

// normalise common letter swaps used by phishing domains: dlscord, disc0rd, d1scord, discorcl …
const deconfuse = (s: string) => s.replace(/0/g, "o").replace(/[1l|]/g, "i").replace(/rn/g, "m").replace(/cl/g, "d").replace(/vv/g, "w");

// Typo-squats ("dlscord", "discorcl", "dicsord") are always suspicious. The real word plus a lure
// ("discord-nitro-gift") is too. Plain third-party sites like discordbotlist.com are left alone.
const LURES = /(nitro|gift|free|promo|claim|verif|login|auth|airdrop|giveaway|drop|reward|bonus|trade|event|support|security|appeal|staff)/;

function isPhish(host: string, brand: string) {
    const label = host.split(".").slice(0, -1).join("-");
    const parts = deconfuse(label).split(/[.-]/);
    const b = deconfuse(brand);
    for (const part of parts) {
        if (part === b) continue;
        if (part.length >= b.length - 1 && part.length <= b.length + 2 && editDistance(part, b) <= 2) return true;
        if (part.includes(b) && part !== b && LURES.test(part.replace(b, ""))) return true;
    }
    return parts.includes(b) && LURES.test(label.replace(new RegExp(brand, "g"), ""))
        || (deconfuse(label).includes(b) && !label.includes(brand)); // only matches after un-swapping 0/1/l: disc0rd, dlscord
}

function editDistance(a: string, b: string) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++)
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[a.length][b.length];
}

export function checkUrl(raw: string): LinkVerdict {
    let u: URL;
    try { u = new URL(raw); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");

    if (IP_LOGGERS.has(host) || [...IP_LOGGERS].some(d => host.endsWith("." + d)))
        return { kind: "iplogger", host, why: "This is an IP logger. Opening it shows the sender your IP address and rough location." };

    if (DISCORD_OFFICIAL.test(host)) {
        if (/^\/ra\//.test(u.pathname))
            return { kind: "qrlogin", host, why: "This is a Discord login QR link. Scanning or approving it logs someone else into YOUR account." };
        return null;
    }
    const steamLure = host.split(/[.-]/).includes("steam") && LURES.test(host);
    if (!STEAM_OFFICIAL.test(host) && (steamLure || isPhish(host, "steamcommunity") || isPhish(host, "steampowered")))
        return { kind: "phishing", host, why: "This imitates Steam. Fake Steam sites steal your login and items." };
    if (isPhish(host, "discord") || isPhish(host, "discordapp"))
        return { kind: "phishing", host, why: "This imitates Discord but isn't a Discord site. These pages steal accounts (often 'free Nitro')." };
    return null;
}

// Tracking parameters removed from links you open
const TRACKERS = /^(utm_[a-z]+|fbclid|gclid|gclsrc|dclid|msclkid|mc_[a-z]+|igshid|igsh|si|ref_src|ref_url|s_cid|_hsenc|_hsmi|mkt_tok|yclid|twclid|ttclid|li_fat_id|wickedid|oly_[a-z]+|vero_[a-z]+|__s|spm|scm|feature|pp|ab_channel)$/i;
const KEEP_SI = /(^|\.)(youtube\.com|youtu\.be|spotify\.com|music\.youtube\.com)$/; // "si"/"feature"/"pp" are trackers there…
const GENERIC_ONLY = new Set(["si", "feature", "pp", "ab_channel", "spm", "scm", "__s"]); // …but may be real params elsewhere

export function cleanUrl(raw: string): string {
    let u: URL;
    try { u = new URL(raw); } catch { return raw; }
    const host = u.hostname.replace(/^www\./, "");
    let changed = false;
    for (const key of [...u.searchParams.keys()]) {
        if (!TRACKERS.test(key)) continue;
        if (GENERIC_ONLY.has(key.toLowerCase()) && !KEEP_SI.test(host)) continue;
        u.searchParams.delete(key);
        changed = true;
    }
    return changed ? u.toString() : raw;
}

export function findFlagged(text: string): NonNullable<LinkVerdict>[] {
    const out: NonNullable<LinkVerdict>[] = [];
    for (const m of text.matchAll(/https?:\/\/[^\s<>()"']+/gi)) {
        const v = checkUrl(m[0]);
        if (v && !out.some(o => o.host === v.host)) out.push(v);
    }
    return out;
}
