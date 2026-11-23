export function getLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(" ");
    const lines: string[] = [];
    let currentLine = words[0];
    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = ctx.measureText(currentLine + " " + word).width;
        if (width < maxWidth) {
            currentLine += " " + word;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);
    return lines;
}

export function formatMediaUrl(rawUrl: string): URL {
    const url = new URL(rawUrl, location.href);
    if (url.hostname === "media.discordapp.net") url.hostname = "cdn.discordapp.com";
    url.searchParams.delete("format");
    url.searchParams.delete("animated");
    url.searchParams.delete("width");
    url.searchParams.delete("height");
    url.searchParams.delete("quality");
    // Exact host or a real subdomain of it. A bare endsWith("tenor.com") also
    // matches lookalikes like "eviltenor.com", since the check has no idea where
    // the domain boundary is.
    const isTenor = url.hostname === "tenor.com" || url.hostname.endsWith(".tenor.com");
    if (isTenor && !url.pathname.endsWith(".gif")) {
        const path = url.pathname;
        const typeIndex = path.lastIndexOf("/") - 1;
        url.pathname = path.slice(0, typeIndex) + "o" + path.slice(typeIndex + 1);
    }
    if (url.pathname.endsWith(".webp")) {
        url.searchParams.set("animated", "true");
    }
    return url;
}
