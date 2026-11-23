/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CspPolicies, ImageSrc } from "@main/csp";

CspPolicies["yt3.googleusercontent.com"] = ImageSrc; // album covers
CspPolicies["lh3.googleusercontent.com"] = ImageSrc; // video thumbnails
