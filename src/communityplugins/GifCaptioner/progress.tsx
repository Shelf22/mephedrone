import { openModal, ModalRoot, ModalHeader, ModalContent, ModalCloseButton } from "@utils/modal";
import { Text, useEffect, useState } from "@webpack/common";

type Updater = (status: string, progress?: number) => void;

function ProgressBody({ onUpdater, initialStatus }: { onUpdater: (u: Updater) => void; initialStatus: string; }) {
    const [status, setStatus] = useState(initialStatus);
    const [progress, setProgress] = useState<number | undefined>(undefined);

    useEffect(() => {
        onUpdater((s, p) => {
            setStatus(s);
            setProgress(p);
        });
    }, []);

    return (
        <div className="gc-progress">
            <Text variant="heading-md/bold">{status}</Text>
            <progress value={progress} max={1} style={{ width: "100%" }} />
        </div>
    );
}

// Replaces the BD original's modalMethods/Modal lookup with Vencord's own
// public modal API - more stable than hunting Discord internals for generic
// modal chrome, since Vencord's @utils/modal is a documented, maintained API
// rather than something we have to reverse-engineer.
export class ProgressDisplay {
    private updater?: Updater;
    private closeFn?: () => void;
    private canceled = false;
    private onCancelCallback?: () => void;

    constructor(title: string, status: string, cancelable = false) {
        openModal(props => {
            this.closeFn = () => props.onClose();
            return (
                <ModalRoot {...props}>
                    <ModalHeader>
                        <Text variant="heading-lg/semibold">{title}</Text>
                        {cancelable && (
                            <ModalCloseButton
                                onClick={() => {
                                    props.onClose();
                                    this.onCancelCallback?.();
                                    this.canceled = true;
                                }}
                            />
                        )}
                    </ModalHeader>
                    <ModalContent>
                        <ProgressBody initialStatus={status} onUpdater={u => (this.updater = u)} />
                    </ModalContent>
                </ModalRoot>
            );
        });
    }

    onCancel(callback: () => void) {
        this.onCancelCallback = callback;
    }

    update(status: string, progress?: number) {
        this.updater?.(status, progress);
    }

    close() {
        this.closeFn?.();
    }
}
