/*
 * Hideaway - Vencord plugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, React, SortedGuildStore, useState, useStateFromStores } from "@webpack/common";
import type { ReactNode } from "react";

import * as Store from "./store";

const MIN_LENGTH = 4;

/** Re-renders the caller whenever the lock state or the hidden lists change. */
export function useHideawayVersion() {
    return React.useSyncExternalStore(Store.subscribe, Store.getVersion);
}

function PasscodeInput({ value, onChange, onEnter, placeholder, autoFocus }: {
    value: string;
    onChange(v: string): void;
    onEnter(): void;
    placeholder: string;
    autoFocus?: boolean;
}) {
    return (
        <input
            className="vc-hideaway-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoFocus={autoFocus}
            placeholder={placeholder}
            value={value}
            onChange={e => onChange(e.currentTarget.value)}
            onKeyDown={e => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    onEnter();
                }
            }}
        />
    );
}

function Fields({ children, shake }: { children: ReactNode; shake: number; }) {
    // Changing the key restarts the shake animation on every wrong attempt
    return <div key={shake} className={`vc-hideaway-fields${shake ? " vc-hideaway-shake" : ""}`}>{children}</div>;
}

function UnlockModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const [code, setCode] = useState("");
    const [busy, setBusy] = useState(false);
    const [shake, setShake] = useState(0);

    async function submit() {
        if (busy || !code) return;
        setBusy(true);
        const ok = await Store.unlock(code);
        setBusy(false);
        if (ok) return modalProps.onClose();
        setCode("");
        setShake(s => s + 1);
    }

    return (
        <Modal
            {...modalProps}
            size="sm"
            title="Enter passcode"
            actions={[
                { text: "Cancel", variant: "secondary", onClick: modalProps.onClose },
                { text: "Unlock", variant: "primary", loading: busy, disabled: !code, onClick: submit }
            ]}
        >
            <Fields shake={shake}>
                <PasscodeInput autoFocus value={code} onChange={setCode} onEnter={submit} placeholder="Passcode" />
                {shake > 0 && <Paragraph className="vc-hideaway-error">Wrong passcode</Paragraph>}
            </Fields>
        </Modal>
    );
}

/** First-time setup, or changing the passcode (then the current one is asked first). */
function SetPasscodeModal({ modalProps, change }: { modalProps: RenderModalProps; change: boolean; }) {
    const [current, setCurrent] = useState("");
    const [code, setCode] = useState("");
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [shake, setShake] = useState(0);

    function fail(message: string) {
        setError(message);
        setShake(s => s + 1);
    }

    async function submit() {
        if (busy) return;
        if (code.length < MIN_LENGTH) return fail(`Use at least ${MIN_LENGTH} characters`);
        if (code !== confirm) return fail("The passcodes don't match");

        setBusy(true);
        try {
            if (change && !(await Store.checkPasscode(current))) {
                setCurrent("");
                return fail("Current passcode is wrong");
            }
            await Store.setPasscode(code);
            if (!change) Store.unlockAfterSetup();
            modalProps.onClose();
        } finally {
            setBusy(false);
        }
    }

    return (
        <Modal
            {...modalProps}
            size="sm"
            title={change ? "Change passcode" : "Set a passcode"}
            subtitle={change ? undefined : "Right-click the Discover button to unlock, and right-click it again to lock."}
            actions={[
                { text: "Cancel", variant: "secondary", onClick: modalProps.onClose },
                { text: "Save", variant: "primary", loading: busy, disabled: !code || !confirm || (change && !current), onClick: submit }
            ]}
        >
            <Fields shake={shake}>
                {change && <PasscodeInput autoFocus value={current} onChange={setCurrent} onEnter={submit} placeholder="Current passcode" />}
                <PasscodeInput autoFocus={!change} value={code} onChange={setCode} onEnter={submit} placeholder="New passcode" />
                <PasscodeInput value={confirm} onChange={setConfirm} onEnter={submit} placeholder="Repeat new passcode" />
                {error && <Paragraph className="vc-hideaway-error">{error}</Paragraph>}
                {!change && (
                    <Paragraph className="vc-hideaway-hint">
                        Once unlocked, right-click a server or DM and pick <b>Move to Hideaway</b>.
                        There's no way to recover a forgotten passcode, see the plugin README.
                    </Paragraph>
                )}
            </Fields>
        </Modal>
    );
}

let modalOpen = false;

function open(render: (props: RenderModalProps) => ReactNode) {
    if (modalOpen) return;
    modalOpen = true;
    openModal(props => render(props), { onCloseCallback: () => { modalOpen = false; } });
}

export function openUnlockModal() {
    if (!Store.isLoaded()) return;
    if (Store.hasPasscode()) open(props => <UnlockModal modalProps={props} />);
    else open(props => <SetPasscodeModal modalProps={props} change={false} />);
}

export function openChangePasscodeModal() {
    if (!Store.isLoaded()) return;
    open(props => <SetPasscodeModal modalProps={props} change={Store.hasPasscode()} />);
}

/* ---------- server list section ---------- */

type RenderTreeNode = (node: any, index: number, total: number) => ReactNode;

/** Hidden servers, shown under the Discover button while unlocked. */
function HideawaySection({ renderTreeNode }: { renderTreeNode: RenderTreeNode; }) {
    useHideawayVersion();
    // Re-render when servers are joined, left or moved
    useStateFromStores([SortedGuildStore], () => (SortedGuildStore as any).getGuildsTree().version);

    if (!Store.isUnlocked() || typeof renderTreeNode !== "function") return null;

    const nodes = ((SortedGuildStore as any).getGuildsTree().sortedGuildNodes() as any[])
        .filter(node => Store.isGuildHidden(node.id));
    if (!nodes.length) return null;

    return (
        <div className="vc-hideaway-section" role="group" aria-label="Hideaway">
            <div className="vc-hideaway-separator" />
            {nodes.map((node, i) => renderTreeNode(node, i, nodes.length))}
        </div>
    );
}

export function renderSection(props: { renderTreeNode: RenderTreeNode; }) {
    return <HideawaySection renderTreeNode={props?.renderTreeNode} />;
}

export function PasscodeSetting() {
    useHideawayVersion();
    return (
        <div className="vc-hideaway-setting">
            <Paragraph>
                {Store.hasPasscode()
                    ? "Changing the passcode asks for the current one first."
                    : "No passcode yet. You can also set one by right-clicking the Discover button."}
            </Paragraph>
            <Button size="small" disabled={!Store.isLoaded()} onClick={openChangePasscodeModal}>
                {Store.hasPasscode() ? "Change passcode" : "Set passcode"}
            </Button>
        </div>
    );
}
