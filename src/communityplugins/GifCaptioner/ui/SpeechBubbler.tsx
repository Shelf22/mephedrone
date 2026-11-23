import { useEffect, useRef, useState } from "@webpack/common";
import { renderSpeechbubble } from "../speechbubble";
import type { Transform } from "../gifRenderer";

interface Props {
    width: number;
    height: number;
    element: HTMLElement;
    onSubmit: (cb: () => Transform) => void;
}

export function SpeechBubbler({ width, height, element, onSubmit }: Props) {
    const [tipX, setTipX] = useState(width / 3);
    const [tipY, setTipY] = useState(height / 3);
    const [tipBase, setTipBase] = useState(10);
    const wrapper = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const ctx = useRef<CanvasRenderingContext2D | null>(null);

    onSubmit(() => ({
        type: "speechbubble" as const,
        tipX,
        tipY,
        tipBase: tipBase / 100
    }));

    const render = () => {
        if (!ctx.current) return;
        ctx.current.clearRect(0, 0, width, height);
        renderSpeechbubble(ctx.current, width, height, tipX, tipY, tipBase / 100);
    };

    const moveTip = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!canvas.current) return;
        const rect = canvas.current.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width * width;
        const y = (e.clientY - rect.top) / rect.height * height;
        setTipX(x);
        setTipY(y);
    };

    useEffect(render, [tipX, tipY, tipBase]);
    useEffect(() => {
        if (!wrapper.current || !canvas.current) return;
        wrapper.current.insertBefore(element, canvas.current);
        ctx.current = canvas.current.getContext("2d");
        render();
    }, []);

    return (
        <div className="gc-editor">
            <div className="gc-range">
                <div>Tip Base Position</div>
                <input
                    type="range"
                    min={0}
                    max={80}
                    value={tipBase}
                    onChange={e => setTipBase(parseFloat(e.target.value))}
                />
            </div>
            <div className="gc-speechbubbler" ref={wrapper}>
                <canvas width={width} height={height} onClick={moveTip} ref={canvas} />
            </div>
        </div>
    );
}
