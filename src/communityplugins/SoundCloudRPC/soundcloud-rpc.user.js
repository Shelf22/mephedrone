// ==UserScript==
// @name         Soundcloud RPC
// @namespace    https://github.com/rbprsp/soundcloud-rpc
// @version      1.0.0
// @description  Sends SoundCloud player state to the SoundCloudRPC Vencord plugin.
// @match        https://soundcloud.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

(function () {
  "use strict";

  const PORT = 38291;
  const POLL_MS_PLAYING = 200;
  const POLL_MS_PAUSED = 1500;

  const ENDPOINT = `http://127.0.0.1:${PORT}/state`;

  const SEL = {
    playBtn: ".playControls__play",
    title: ".playbackSoundBadge__titleLink",
    artist: ".playbackSoundBadge__lightLink",
    artwork: "span.sc-artwork.sc-artwork-4x.image__full",
    timeline: ".playbackTimeline__progressWrapper",
  };

  const q = (sel) => document.querySelector(sel);

  function upgradeArtworkUrl(url) {
    return url.replace(
      /-(t\d+x\d+|large|small|tiny|mini|badge|crop)\.(jpg|jpeg|png|webp)/i,
      "-t500x500.$2",
    );
  }

  function getArtwork() {
    const el = q(SEL.artwork);
    if (el) {
      const bg =
        el.style?.backgroundImage || getComputedStyle(el).backgroundImage || "";
      const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (m?.[1] && !m[1].includes("about:blank"))
        return upgradeArtworkUrl(m[1]);
    }
    const ms = navigator.mediaSession?.metadata?.artwork;
    if (ms?.length) {
      let best = ms[0],
        bestSize = 0;
      for (const a of ms) {
        const m = (a.sizes || "").match(/t?(\d+)x/);
        const size = m ? parseInt(m[1]) : 0;
        if (size > bestSize) {
          bestSize = size;
          best = a;
        }
      }
      if (best?.src) return best.src;
    }
    return "";
  }

  function cleanTitle(t) {
    if (!t) return "";
    let s = t.replace(/^Current\s+track:\s*/i, "").trim();
    s = s.replace(/\s+/g, " ");
    const m = s.match(/^(.+?)\s+\1$/);
    if (m) s = m[1];
    return s;
  }

  function getTitle() {
    const el = q(SEL.title);
    if (el) {
      const attr = el.getAttribute("title");
      if (attr) return cleanTitle(attr);
      const clone = el.cloneNode(true);
      clone.querySelectorAll(".sc-visuallyhidden").forEach((n) => n.remove());
      const text = cleanTitle(clone.textContent || "");
      if (text) return text;
    }
    return cleanTitle(navigator.mediaSession?.metadata?.title ?? "");
  }

  function getArtist() {
    return (
      navigator.mediaSession?.metadata?.artist ||
      q(SEL.artist)?.textContent?.trim() ||
      ""
    );
  }

  function getPermalink() {
    const a = q(SEL.title);
    if (a?.href && a.href.split("/").length > 4) return a.href.split("?")[0];
    return "";
  }

  function getIsPlaying() {
    const btn = q(SEL.playBtn);
    if (btn) return btn.classList.contains("playing");
    const ms = navigator.mediaSession?.playbackState;
    return ms === "playing";
  }

  function getPosition() {
    const prog = q(SEL.timeline);
    if (!prog) return 0;
    return Math.round(
      parseFloat(prog.getAttribute("aria-valuenow") || "0") * 1000,
    );
  }

  function getDuration() {
    const prog = q(SEL.timeline);
    if (!prog) return 0;
    const max = parseFloat(prog.getAttribute("aria-valuemax") || "0");
    return max > 0 ? Math.round(max * 1000) : 0;
  }

  function buildState() {
    const title = getTitle();
    if (!title) return undefined;
    const permalink = getPermalink();
    return {
      track: {
        id: permalink || title,
        title,
        artist: getArtist(),
        duration: getDuration(),
        thumbnail: getArtwork(),
        permalink,
      },
      isPlaying: getIsPlaying(),
      position: getPosition(),
    };
  }

  let _lastJson = "";
  let _suppressedNull = false;

  function send(state) {
    const json = state ? JSON.stringify(state) : "null";
    if (json === _lastJson && state?.isPlaying) return;
    if (!state && _suppressedNull) return;
    _lastJson = json;
    _suppressedNull = !state;

    GM_xmlhttpRequest({
      method: "POST",
      url: ENDPOINT,
      headers: { "Content-Type": "application/json" },
      data: json,
      timeout: 2000,
      onerror: () => {},
      ontimeout: () => {},
    });
  }

  function tick() {
    const state = buildState();
    if (state !== undefined) send(state);
    setTimeout(tick, state?.isPlaying ? POLL_MS_PLAYING : POLL_MS_PAUSED);
  }

  window.addEventListener("pagehide", () => send(null));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && !getIsPlaying()) send(null);
  });

  function setupObserver() {
    const bar = q(".playControls");
    if (!bar) {
      setTimeout(setupObserver, 1000);
      return;
    }
    new MutationObserver(() => {
      const state = buildState();
      if (state !== undefined) send(state);
    }).observe(bar, { attributes: true, childList: true, subtree: true });
  }
  setupObserver();
  tick();
})();
