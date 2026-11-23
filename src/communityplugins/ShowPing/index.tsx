import definePlugin from "@utils/types";
import { React } from "@webpack/common";

function PingBadge({ ping }: { ping: number | null; }) {
    if (ping == null || ping <= 0) return null;

    const color = ping < 80
        ? "#23a55a"
        : ping < 150
            ? "#f0b232"
            : "#f23f43";

    return (
        <div style={{
            fontSize: "11px",
            fontWeight: 500,
            lineHeight: "16px",
            color,
            fontVariantNumeric: "tabular-nums",
            marginTop: "-2px",
        }}>
            {ping} ms
        </div>
    );
}

export default definePlugin({
    name: "ShowPing",
    description: "Displays the WebSocket ping in the voice panel, below the channel name.",
    authors: [{ name: "gaprj", id: 660576985050775552n }],

    patches: [{
        find: "renderConnectionStatus",
        replacement: {
            match: /children:this\.renderConnectionStatus\(\)/,
            replace: "children:[this.renderConnectionStatus(),$self.renderPing(this.props.rtcConnectionLastPing)]"
        }
    }],

    renderPing(ping: number | null) {
        try { return <PingBadge ping={ping} />; }
        catch { return null; }
    }
});
