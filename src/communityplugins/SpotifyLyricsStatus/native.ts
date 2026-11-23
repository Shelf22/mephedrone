/**
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ilyau and contributors
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "child_process";
import { IpcMainInvokeEvent } from "electron";
import { promisify } from "util";

import type { NativeFetchRequest, NativeFetchResponse, WindowsSpotifyState } from "./types";

const execFileAsync = promisify(execFile);

const ALLOWED_HOSTS = new Set([
    "lrclib.net",
    "api.deezer.com",
    "www.deezer.com",
    "itunes.apple.com",
    "music.163.com"
]);

const USER_AGENT = "SpotifyLyricsStatus (https://github.com/Who1sme6/SpotifyLyricsStatus)";

function assertAllowed(url: string) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
        throw new Error(`Blocked host: ${parsed.hostname}`);
    }
    return parsed;
}

export async function fetchJson(_event: IpcMainInvokeEvent, request: NativeFetchRequest): Promise<NativeFetchResponse> {
    try {
        const parsed = assertAllowed(request.url);
        const response = await fetch(parsed, {
            method: request.method ?? "GET",
            headers: {
                Accept: "application/json",
                "User-Agent": USER_AGENT,
                ...request.headers
            },
            body: request.method === "POST" ? request.body ?? "{}" : undefined
        });

        if (response.status === 404) return { status: 404, data: null };

        const text = await response.text();
        let data: unknown = null;
        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                data = { raw: text };
            }
        }

        return { status: response.status, data };
    } catch (error) {
        return { status: -1, data: { error: String(error) } };
    }
}

function comparable(value: string) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export async function searchAlbumImage(
    _event: IpcMainInvokeEvent,
    title: string,
    artist: string,
    album: string
): Promise<string> {
    const query = [title, artist.split(",")[0] || artist, album].map(part => part.trim()).filter(Boolean).join(" ");
    if (!query) return "";

    const url = new URL("https://itunes.apple.com/search");
    url.searchParams.set("term", query);
    url.searchParams.set("media", "music");
    url.searchParams.set("entity", "song");
    url.searchParams.set("limit", "8");

    const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT }
    });
    if (!response.ok) return "";

    const data = await response.json() as {
        results?: Array<{
            trackName?: string;
            artistName?: string;
            collectionName?: string;
            artworkUrl100?: string;
        }>;
    };

    const wantTitle = comparable(title);
    const wantArtist = comparable(artist.split(",")[0] || artist);
    const wantAlbum = comparable(album);

    const best = data.results
        ?.filter(result => result.artworkUrl100)
        .sort((a, b) => {
            const score = (item: typeof a) => {
                let value = 0;
                const gotTitle = comparable(item.trackName || "");
                const gotArtist = comparable(item.artistName || "");
                const gotAlbum = comparable(item.collectionName || "");
                if (gotTitle === wantTitle) value += 4;
                else if (gotTitle.includes(wantTitle)) value += 2;
                if (gotArtist === wantArtist) value += 4;
                else if (gotArtist.includes(wantArtist)) value += 2;
                if (wantAlbum && gotAlbum === wantAlbum) value += 2;
                return value;
            };
            return score(b) - score(a);
        })[0];

    return best?.artworkUrl100?.replace(/\/\d+x\d+bb\./, "/600x600bb.") || "";
}

export async function getWindowsSpotifyState(_event: IpcMainInvokeEvent): Promise<WindowsSpotifyState> {
    if (process.platform !== "win32") return { processRunning: false, track: null };

    const script = `
$ErrorActionPreference = "SilentlyContinue"
$processRunning = [bool](Get-Process Spotify -ErrorAction SilentlyContinue | Select-Object -First 1)
$track = $null
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
    function Await($AsyncOperation, $ResultType) {
        $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod })[0]
        $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($AsyncOperation))
        return $task.GetAwaiter().GetResult()
    }
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
    $manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    foreach ($session in $manager.GetSessions()) {
        if (($session.SourceAppUserModelId -as [string]) -notmatch "Spotify") { continue }
        $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        $timeline = $session.GetTimelineProperties()
        if ($props.Title) {
            $track = [pscustomobject]@{
                title = $props.Title
                artist = $props.Artist
                album = $props.AlbumTitle
                status = $session.GetPlaybackInfo().PlaybackStatus.ToString()
                positionMs = [math]::Max(0, [int64]$timeline.Position.TotalMilliseconds)
                durationMs = [math]::Max(0, [int64]$timeline.EndTime.TotalMilliseconds)
            }
            break
        }
    }
} catch {}
[pscustomobject]@{ processRunning = $processRunning; track = $track } | ConvertTo-Json -Compress
`;

    try {
        const { stdout } = await execFileAsync("powershell.exe", [
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-Command", script
        ], {
            windowsHide: true,
            timeout: 2500,
            maxBuffer: 64 * 1024
        });

        return JSON.parse(stdout.trim() || '{"processRunning":false,"track":null}');
    } catch {
        return { processRunning: false, track: null };
    }
}
