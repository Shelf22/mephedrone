/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type Permission = "commands" | "messages.read" | "messages.send" | "messages.transform" | "notify" | "style" | "network";

export interface SettingDef {
    type: "string" | "boolean" | "select";
    label: string;
    default: any;
    options?: [string, string][];
}

export interface Manifest {
    id: string;
    name: string;
    version: string;
    author: string;
    icon?: string;
    description: string;
    category?: string;
    permissions: Permission[];
    network?: string[];
    settings?: Record<string, SettingDef>;
}

/** an entry in a store index; code is either a URL relative to the index or (built-in) inline text */
export interface CatalogEntry extends Manifest {
    sha256: string;
    code?: string;
    codeText?: string;
    source?: string;
}

export interface Installed {
    manifest: Manifest;
    code: string;
    sha256: string;
    source: string;
    enabled: boolean;
    settings: Record<string, any>;
    storage: Record<string, any>;
}

export const PERMISSION_INFO: Record<Permission, { icon: string; label: string; risky?: boolean; }> = {
    "commands": { icon: "⌨️", label: "Add slash commands" },
    "messages.read": { icon: "👁️", label: "Read messages you receive", risky: true },
    "messages.send": { icon: "💬", label: "Send messages as you (max 5 per 10 seconds)", risky: true },
    "messages.transform": { icon: "✏️", label: "Change your messages before they're sent", risky: true },
    "notify": { icon: "🔔", label: "Show pop-up notifications" },
    "style": { icon: "🎨", label: "Change how the client looks" },
    "network": { icon: "🌐", label: "Connect to the internet", risky: true },
};
