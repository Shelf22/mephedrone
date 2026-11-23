/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2024 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import SettingsPlugin from "@plugins/_core/settings";
import definePlugin from "@utils/types";

import { NAV_TRANSLATIONS } from "./navTranslations";
import { UI_TRANSLATIONS } from "./uiTranslations";

export default definePlugin({
    name: "Japanese Localization",
    description: "Improves Vencord's Japanese localization",
    authors: [{ name: "scolor-dev", id: 943279903187542058n }],

    start() {
        // NAVラベル: Settings プラグインの buildLayout を直接ラップする
        const orig = (SettingsPlugin as any).buildLayout.bind(SettingsPlugin);
        (this as any)._origBuildLayout = orig;
        (SettingsPlugin as any).buildLayout = (builder: any) =>
            this.wrapLayout(orig(builder));

        // タブ内テキスト: MutationObserver でテキストノードを置換する
        (this as any)._observer = new MutationObserver(mutations => {
            for (const { addedNodes } of mutations) {
                for (const node of addedNodes) {
                    if (!(node instanceof Element)) continue;
                    // すでにVencordコンテナ内なら直接翻訳（タブ切り替え時の子要素追加など）
                    if (node.closest?.(".vc-settings-tab") || node.closest?.('[role="dialog"]')) {
                        this.translateElement(node);
                    } else {
                        // 新規追加ノード内にVencordコンテナがあれば翻訳
                        this.translateTabs(node);
                    }
                }
            }
        });
        (this as any)._observer.observe(document.body, { childList: true, subtree: true });

        // すでに表示中のタブも翻訳する
        this.translateTabs(document.body);
    },

    stop() {
        if ((this as any)._origBuildLayout) {
            (SettingsPlugin as any).buildLayout = (this as any)._origBuildLayout;
        }
        (this as any)._observer?.disconnect();
    },

    translateTabs(root: Element) {
        for (const sel of [".vc-settings-tab", "[role=\"dialog\"]"]) {
            const els = root.matches?.(sel) ? [root] : Array.from(root.querySelectorAll(sel));
            for (const el of els) this.translateElement(el);
        }
    },

    translateElement(el: Element) {
        // テキストノードを翻訳
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const nodes: Text[] = [];
        let n: Node | null;
        while ((n = walker.nextNode())) nodes.push(n as Text);
        for (const textNode of nodes) {
            const key = textNode.textContent?.trim();
            if (key && UI_TRANSLATIONS[key] !== undefined) {
                textNode.textContent = UI_TRANSLATIONS[key];
            }
        }
        // placeholder 属性を翻訳
        for (const inp of [el, ...Array.from(el.querySelectorAll("[placeholder]"))]) {
            const ph = inp.getAttribute?.("placeholder")?.trim();
            if (ph && UI_TRANSLATIONS[ph] !== undefined) {
                inp.setAttribute("placeholder", UI_TRANSLATIONS[ph]);
            }
        }
    },

    translateNav(str: string): string {
        return NAV_TRANSLATIONS[str] ?? str;
    },

    wrapNode(node: any): void {
        if (!node) return;
        for (const method of ["useTitle", "useLabel"]) {
            if (typeof node[method] === "function") {
                const orig = node[method];
                const translateNav = this.translateNav.bind(this);
                node[method] = function () { return translateNav(orig.call(this)); };
            }
        }
        if (typeof node.buildLayout === "function") {
            const orig = node.buildLayout;
            const wrapLayout = this.wrapLayout.bind(this);
            node.buildLayout = function () { return wrapLayout(orig.call(this)); };
        }
    },

    wrapLayout(nodes: any[]): any[] {
        if (!Array.isArray(nodes)) return nodes;
        for (const node of nodes) this.wrapNode(node);
        return nodes;
    }
});
