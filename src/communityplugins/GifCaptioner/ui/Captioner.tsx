import { useEffect, useRef, useState } from "@webpack/common";
import { getLines } from "../utils";
import type { Transform } from "../gifRenderer";

interface Props {
    width: number;
    element: HTMLElement;
    onSubmit: (cb: () => Transform) => void;
}

function fontString(size: number) {
    return `900 ${size}px Impact, "Arial Narrow", sans-serif`;
}

export function Captioner({ width, element, onSubmit }: Props) {
    const [text, setText] = useState("");
    const [size, setSize] = useState(width / 10);
    const input = useRef<HTMLInputElement>(null);
    const wrapper = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const ctx = useRef<CanvasRenderingContext2D | null>(null);

    onSubmit(() => ({ text, size, type: "caption" as const }));

    const render = () => {
        if (!canvas.current || !ctx.current) return;
        const lines = getLines(ctx.current, text || "Enter caption...", width);
        const captionHeight = lines.length * size + 10;
        canvas.current.height = captionHeight;
        ctx.current.fillStyle = "white";
        ctx.current.fillRect(0, 0, width, captionHeight);
        ctx.current.textAlign = "center";
        ctx.current.textBaseline = "top";
        ctx.current.font = fontString(size);
        ctx.current.fillStyle = "black";
        for (let i = 0; i < lines.length; i++) {
            ctx.current.fillText(lines[i], width / 2, size * i + 5);
        }
    };

    useEffect(render, [text, size]);
    useEffect(() => {
        setTimeout(() => input.current?.focus(), 100);
        if (!wrapper.current || !canvas.current) return;
        wrapper.current.appendChild(element);
        ctx.current = canvas.current.getContext("2d");
        render();
    }, []);

    return (
        <div className="gc-editor" ref={wrapper}>
            <input
                onChange={e => setText(e.target.value)}
                ref={input}
                className="gc-caption"
                placeholder="Enter caption..."
            />
            <div className="gc-range">
                <div>Font size</div>
                <input
                    type="range"
                    min={5}
                    max={200}
                    value={size}
                    onChange={e => setSize(parseFloat(e.target.value))}
                />
            </div>
            <canvas width={width} ref={canvas} />
        </div>
    );
}
