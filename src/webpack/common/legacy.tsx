/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// [MEPHEDRONE] compatibility layer: the old @webpack/common components that Vencord/Equicord removed,
// rebuilt on top of the current ones, so community plugins written for older versions keep working.

import { Button as NewButton } from "@components/Button";
import { Divider } from "@components/Divider";
import { FormSwitch } from "@components/FormSwitch";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Switch as NewSwitch } from "@components/Switch";
import { Text as NewText, TextColor, TextSize, TextWeight } from "@components/Text";
import type { ComponentProps, ReactNode } from "react";

import { showToast } from "./utils";

// ---------- Toasts (Discord's old toast API)
const ToastType = { DEFAULT: "message", MESSAGE: "message", SUCCESS: "success", FAILURE: "failure", CUSTOM: "custom", CLIP: "clip", LINK: "link", FORWARD: "forward", BOOKMARK: "bookmark", CLOCK: "clock" } as const;
const ToastPosition = { TOP: 0, BOTTOM: 1 } as const;
let toastId = 0;

export const Toasts = {
    Type: ToastType,
    Position: ToastPosition,
    genId: () => String(++toastId),
    create: (message: string, type: string = ToastType.MESSAGE, options?: any) => ({ message, type, id: String(++toastId), options }),
    show(data: { message?: string; text?: string; type?: string; options?: { position?: number; duration?: number; }; [k: string]: any; }) {
        showToast({
            text: String(data.message ?? data.text ?? ""),
            variant: data.type === ToastType.SUCCESS ? "success" : data.type === ToastType.FAILURE ? "critical" : "default",
            position: data.options?.position === ToastPosition.BOTTOM ? "bottom" : undefined,
            duration: data.options?.duration,
        });
    },
    pop() { },
};

// ---------- Button (old Discord Button with Colors / Looks / Sizes)
const Colors = { BRAND: "brand", RED: "red", GREEN: "green", PRIMARY: "primary", LINK: "link", WHITE: "white", TRANSPARENT: "transparent", CUSTOM: "custom", BRAND_NEW: "brand", YELLOW: "yellow" } as const;
const Looks = { FILLED: "filled", OUTLINED: "outlined", LINK: "link", BLANK: "blank" } as const;
const Sizes = { NONE: "none", TINY: "tiny", SMALL: "small", MEDIUM: "medium", LARGE: "large", XLARGE: "xlarge", MIN: "min", MAX: "max", ICON: "icon" } as const;

type LegacyButtonProps = ComponentProps<"button"> & { color?: string; look?: string; size?: string; innerClassName?: string; wrapperClassName?: string; grow?: boolean; children?: ReactNode; [k: string]: any; };

function LegacyButtonImpl({ color, look, size, innerClassName: _i, wrapperClassName: _w, grow: _g, ...rest }: LegacyButtonProps) {
    const variant = look === Looks.LINK || color === Colors.LINK ? "link"
        : color === Colors.RED ? "dangerPrimary"
            : color === Colors.GREEN ? "positive"
                : look === Looks.OUTLINED || look === Looks.BLANK || color === Colors.PRIMARY || color === Colors.TRANSPARENT || color === Colors.WHITE ? "secondary"
                    : "primary";
    const s = size === Sizes.TINY || size === Sizes.SMALL ? "small" : size === Sizes.MIN || size === Sizes.NONE ? "min" : size === Sizes.ICON ? "iconOnly" : "medium";
    return <NewButton variant={variant} size={s} {...(rest as any)} />;
}
export const Button = Object.assign(LegacyButtonImpl, { Colors, Looks, Sizes }) as any;

// ---------- Text (old variant="text-md/semibold" API)
export function Text({ variant, color, tag, ...rest }: { variant?: string; color?: string; tag?: string; [k: string]: any; }) {
    const [kind, w] = String(variant ?? "text-md/normal").split("/");
    const sz = (kind.match(/(xxs|xs|sm|md|lg|xl|xxl)$/)?.[1] ?? "md") as TextSize;
    const colorMap: Record<string, TextColor> = {
        "header-primary": "text-strong", "header-secondary": "text-muted", "text-normal": "text-default", "text-muted": "text-muted",
        "interactive-normal": "text-default", "status-danger": "text-danger", "text-danger": "text-danger", "text-positive": "text-feedback-positive",
        "status-positive": "text-feedback-positive", "text-brand": "text-brand", "text-link": "text-link",
    };
    return <NewText size={sz} weight={(w ?? "normal") as TextWeight} color={color ? colorMap[color] ?? (color as TextColor) : undefined} tag={(tag ?? "div") as any} {...rest} />;
}

// ---------- Forms (old FormTitle / FormText / FormSection …)
const FormTitle = ({ tag = "h5", children, ...rest }: any) => <Heading tag={tag} {...rest}>{children}</Heading>;
const FormText = ({ children, type: _t, ...rest }: any) => <Paragraph {...rest}>{children}</Paragraph>;
const FormLabel = ({ children, ...rest }: any) => <NewText weight="semibold" size="sm" {...rest}>{children}</NewText>;
const FormDivider = (props: any) => <Divider {...props} />;
const FormSection = ({ title, children, className, tag: _t, ...rest }: any) => (
    <section className={className} {...rest}>{title && <FormTitle>{title}</FormTitle>}{children}</section>
);
const FormItem = ({ title, children, className, ...rest }: any) => (
    <div className={className} {...rest}>{title && <FormTitle>{title}</FormTitle>}{children}</div>
);
const FormSwitchLegacy = ({ value, onChange, note, children, disabled, hideBorder, className }: any) => (
    <FormSwitch title={children} description={note} value={!!value} onChange={onChange} disabled={disabled} hideBorder={hideBorder} className={className} />
);
export const Forms = { FormTitle, FormText, FormLabel, FormDivider, FormSection, FormItem, FormSwitch: FormSwitchLegacy } as any;
export const FormSwitchCompat = FormSwitchLegacy;

// ---------- Switch (old checked/onChange signature is the same; also accept `value`)
export const Switch = ({ value, checked, ...rest }: any) => <NewSwitch checked={checked ?? !!value} {...rest} />;

export const HeadingPrimary = (p: any) => <Heading tag="h2" {...p} />;
export const HeadingSecondary = (p: any) => <Heading tag="h3" {...p} />;
export const HeadingTertiary = (p: any) => <Heading tag="h4" {...p} />;
