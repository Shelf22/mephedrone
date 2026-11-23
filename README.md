# [MEPHEDRONE]

A privacy-first Discord client with a fully custom look and the biggest plugin library around.
Built on [Vencord](https://github.com/Vendicated/Vencord), [Equicord](https://github.com/Equicord/Equicord) and [Equibop](https://github.com/Equicord/Equibop).

> **Heads up:** client mods are against Discord's Terms of Service. Discord doesn't usually act on them, but use it at your own risk.

## Download

**Linux:** grab `Mephedrone-x86_64.AppImage` from [Releases](../../releases), then:

```sh
chmod +x Mephedrone-*-x86_64.AppImage
./Mephedrone-*-x86_64.AppImage
```

Log in as usual. Your settings live in `~/.config/mephedrone`. Windows is planned.

## What you get

### Your style
- **4 styles:** Terminal, Glass, Minimal and Classic. Each restyles the whole client, not just the colours.
- Pick your own accent colour, font, corner roundness, darkness and message layout (bubbles or terminal-style).
- **Motion:** messages spring in, menus pop, channels slide, and server icons lift and glow. Off, subtle or full.

### Privacy
- **Telemetry blocked:** Discord's analytics and crash reporting are cut off.
- **Location spoofing:** your timezone, language and location are randomized again every time you start the app.
- **Clean uploads:** GPS, camera and other hidden info is stripped from images before they're sent.
- **Encrypted messages:** lock a chat with a shared passphrase (AES-256-GCM). Discord only ever sees scrambled text.
- **Lock screen:** a PIN on startup or after you've been idle, with lockouts after wrong guesses.
- **Link safety:** warns you about known scam and phishing links before you click.
- **Voice lockdown:** optionally confirm before joining a call or join muted, and see whether a call is end-to-end encrypted.
- **Embed lockdown:** Spotify, SoundCloud and other third-party players don't load until you click them, so those companies don't see you just by scrolling past.
- `/ghost` goes invisible, hides your game and stops typing indicators in one go.

### Plugins
- **~600 plugins** from Vencord, Equicord and 200+ community authors, all built in. Turn on what you want.
- **Plugin store:** extra plugins run in a sandbox and ask for permission before they can do anything. Each is fingerprinted, so it can't change after review.
- **BetterDiscord plugins (opt-in):** a hand-checked set of BD plugins, each scanned for malicious code and fingerprinted.

### Desktop app
- No auto-updater phoning home, and no remote code downloads: everything ships inside the app.
- DevTools are off by default, which blocks "paste this in your console" token scams. Start with `--devtools` if you need them.

## Safety

Every bundled community plugin was scanned for token theft, hidden network calls, obfuscated code, remote code loading and automation that could get your account banned. Plugins that failed were removed. Plugins that run code on your PC only work while you have them turned on.

Found a security problem? Please open a private [security advisory](../../security/advisories/new) instead of a public issue.

## Building from source

Needs Node.js, pnpm and [Bun](https://bun.sh).

```sh
pnpm install
pnpm build                    # the client → dist/equibop
cd app && bun install
bun run package               # the desktop app → app/dist/*.AppImage
```

The desktop app's source is in [mephedrone-desktop](https://github.com/Shelf22/mephedrone-desktop).

## Credits

[MEPHEDRONE] stands on the work of [Vendicated and the Vencord contributors](https://github.com/Vendicated/Vencord), [the Equicord team](https://github.com/Equicord), and every community plugin author listed in [COMMUNITY_PLUGINS.md](COMMUNITY_PLUGINS.md). Thank you.

## License

GPL-3.0-or-later. Community plugins keep their original (GPL-compatible) licences.
