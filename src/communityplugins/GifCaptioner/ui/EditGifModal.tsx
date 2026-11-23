import { useState } from "@webpack/common";
import { Captioner } from "./Captioner";
import { SpeechBubbler } from "./SpeechBubbler";
import type { Transform } from "../gifRenderer";

const tabs = [
    { key: "caption", label: "Caption" },
    { key: "speechbubble", label: "Speech Bubble" }
] as const;

interface Props {
    width: number;
    height: number;
    element: HTMLElement;
    onSubmit: (cb: () => Transform) => void;
}

export function EditGifModal({ width, height, element, onSubmit }: Props) {
    const [activeTab, setTab] = useState<typeof tabs[number]["key"]>("caption");

    return (
        <div className="gc-modal">
            <div className="gc-tabs">
                {tabs.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setTab(tab.key)}
                        className={activeTab === tab.key ? "active" : ""}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            {activeTab === "caption"
                ? <Captioner width={width} element={element} onSubmit={onSubmit} />
                : <SpeechBubbler width={width} height={height} element={element} onSubmit={onSubmit} />}
        </div>
    );
}
