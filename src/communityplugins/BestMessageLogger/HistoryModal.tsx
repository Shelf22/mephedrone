/*
 * BestMessageLogger, a Vencord plugin by Kh8da
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { TooltipContainer } from "@components/TooltipContainer";
import { classNameFactory } from "@utils/css";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { RenderModalProps } from "@vencord/discord-types";
import { findCssClassesLazy } from "@webpack";
import { Modal, openModal, TabBar, Timestamp, useState } from "@webpack/common";

import { parseEditContent } from "./utils";

const CodeContainerClasses = findCssClassesLazy("markup", "codeContainer");
const MiscClasses = findCssClassesLazy("messageContent", "markupRtl");

const cl = classNameFactory("vc-bml-modal-");

export function openHistoryModal(message: any) {
    openModal(props =>
        <ErrorBoundary>
            <HistoryModal modalProps={props} message={message} />
        </ErrorBoundary>
    );
}

function toDate(value: any): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function HistoryModal({ modalProps, message }: { modalProps: RenderModalProps; message: any; }) {
    const history: Array<{ timestamp: Date; content: string; }> = message.editHistory ?? [];
    const [currentTab, setCurrentTab] = useState(history.length);
    const first = toDate(message.firstEditTimestamp) ?? toDate(message.timestamp);
    const sent = toDate(message.timestamp);
    const timestamps = [first, ...history.map(m => toDate(m.timestamp))];
    const contents = [...history.map(m => m.content), message.content];

    return (
        <Modal {...modalProps} size="lg" title="Message Edit History">
            <TabBar
                type="top"
                look="brand"
                className={classes("vc-settings-tab-bar", cl("tab-bar"))}
                selectedItem={currentTab}
                onItemSelect={setCurrentTab}
            >
                {first && sent && first.getTime() !== sent.getTime() && (
                    <TooltipContainer text="This version was not logged, so it can't be shown.">
                        <TabBar.Item className="vc-settings-tab-bar-item" id={-1} disabled>
                            <Timestamp className={cl("timestamp")} timestamp={sent} isEdited={true} isInline={false} />
                        </TabBar.Item>
                    </TooltipContainer>
                )}
                {timestamps.map((timestamp, index) => (
                    <TabBar.Item key={index} className="vc-settings-tab-bar-item" id={index}>
                        {timestamp
                            ? <Timestamp className={cl("timestamp")} timestamp={timestamp} isEdited={true} isInline={false} />
                            : "Unknown time"}
                    </TabBar.Item>
                ))}
            </TabBar>

            <div className={classes(CodeContainerClasses.markup, MiscClasses.messageContent, Margins.top20)}>
                {parseEditContent(contents[currentTab] ?? "", message)}
            </div>
        </Modal>
    );
}
