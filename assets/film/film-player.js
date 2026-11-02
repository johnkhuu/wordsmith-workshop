/*
 * Wordsmith Workshop film: the player.
 *
 * Wires a <figure data-film> to the scenes and the audio. The picture is
 * drawn from the audio clock, so it can't drift from the sound. Without
 * Web Audio it plays silently on the page clock.
 */
(function (root) {
  "use strict";
  const S = root.WordsmithFilmScenes;
  const A = root.WordsmithFilmAudio;
  const K = root.WordsmithFilmKit;
  if (!S || !K) return;

  const POSTER_T = 26.8; // title and tagline done, the call to action not yet in (the play button sits there)
  const CAPTION_HOLD = 0.35;
  const FONTS = ["700 40px Caveat", "600 40px Caveat", "400 40px Gloock", "700 40px 'Courier Prime'",
    "700 40px 'Atkinson Hyperlegible'", "400 40px 'Atkinson Hyperlegible'"];

  const fmt = (s) => {
    s = Math.max(0, Math.round(s));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  };

  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const all = Promise.all(FONTS.map((f) => document.fonts.load(f).catch(() => null)));
    const timeout = new Promise((r) => setTimeout(r, 2500));
    return Promise.race([all, timeout]);
  }

  function captionAt(t) {
    for (const c of S.CUES) if (t >= c.at && t <= c.at + c.dur + CAPTION_HOLD) return c;
    return null;
  }

  function mount(fig) {
    const canvas = fig.querySelector(".film-canvas");
    const caption = fig.querySelector(".film-caption");
    const bigPlay = fig.querySelector(".film-big-play");
    const toggle = fig.querySelector(".film-toggle");
    const seek = fig.querySelector(".film-seek");
    const time = fig.querySelector(".film-time");
    const ccBtn = fig.querySelector(".film-cc");
    const muteBtn = fig.querySelector(".film-mute");
    const status = fig.querySelector(".film-status");
    const ctx = canvas.getContext("2d");
    const audio = A ? A.createPlayer(fig.dataset.voBase || "assets/film/vo/") : null;

    const state = { t: POSTER_T, offset: 0, playing: false, started: false, ended: false, built: false, frame: -1, clockStart: 0, captions: true, muted: false };
    seek.max = String(S.DURATION);
    seek.step = "0.01";

    function size() {
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      const w = Math.max(320, Math.round(canvas.clientWidth * dpr));
      const bw = Math.min(K.W, w);
      if (canvas.width !== bw) {
        canvas.width = bw;
        canvas.height = Math.round((bw * 9) / 16);
        state.frame = -1;
      }
    }

    function draw(force) {
      if (!state.built) return;
      const frame = Math.floor(state.t * S.FPS);
      if (!force && frame === state.frame) return;
      state.frame = frame;
      const s = canvas.width / K.W;
      ctx.setTransform(s, 0, 0, s, 0, 0);
      S.renderFrame(ctx, state.t);
    }

    function setCaption() {
      const c = state.started && state.captions ? captionAt(state.t) : null;
      const text = c ? (c.voice === "bot" ? "“" + c.text + "”" : c.text) : "";
      if (caption.textContent !== text) {
        caption.textContent = text;
        caption.classList.toggle("is-bot", !!c && c.voice === "bot");
        caption.hidden = !text;
      }
    }

    function setUi() {
      fig.classList.toggle("is-playing", state.playing);
      fig.classList.toggle("is-started", state.started);
      fig.classList.toggle("is-ended", state.ended);
      toggle.setAttribute("aria-label", state.playing ? "Pause" : state.ended ? "Replay" : "Play");
      toggle.dataset.state = state.playing ? "pause" : state.ended ? "replay" : "play";
      if (document.activeElement !== seek) seek.value = String(state.started ? state.t : 0);
      seek.style.setProperty("--progress", ((state.started ? state.t : 0) / S.DURATION) * 100 + "%");
      time.textContent = fmt(state.started ? state.t : 0) + " / " + fmt(S.DURATION);
      setCaption();
    }

    async function build() {
      if (state.built) return;
      await fontsReady();
      S.build();
      state.built = true;
      size();
      draw(true);
    }

    function clock() {
      const a = audio && audio.time();
      if (a != null) return a;
      return state.offset + (performance.now() - state.clockStart) / 1000;
    }

    let raf = 0;
    function loop() {
      if (!state.playing) return;
      state.t = Math.min(S.DURATION, clock());
      if (state.t >= S.DURATION) {
        state.t = S.DURATION;
        stop(true);
      }
      draw();
      setUi();
      raf = state.playing ? requestAnimationFrame(loop) : 0;
    }

    function stop(ended) {
      state.playing = false;
      state.ended = !!ended;
      state.offset = state.t;
      if (audio) audio.pause();
      cancelAnimationFrame(raf);
      draw(true);
      setUi();
    }

    async function play(from) {
      await build();
      if (state.ended || from === 0) { state.t = 0; state.ended = false; }
      if (from != null) state.t = from;
      state.started = true;
      state.offset = state.t;
      let withSound = false;
      if (audio && audio.available) {
        if (status) { status.textContent = "Loading sound…"; status.hidden = false; }
        try { withSound = await audio.ensure(); }
        catch (e) { withSound = false; if (status) status.textContent = "The sound didn’t load. Playing without it."; }
        if (status && withSound) status.hidden = true;
      }
      if (withSound) audio.play(state.offset);
      state.clockStart = performance.now();
      state.playing = true;
      setUi();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    }

    // Called straight from click and key handlers: unlock the audio while
    // the gesture still counts, then start.
    function togglePlay() {
      if (state.playing) { stop(false); return; }
      if (audio) audio.unlock();
      play(state.ended ? 0 : undefined);
    }

    bigPlay.addEventListener("click", () => {
      if (audio) audio.unlock();
      play(state.started ? undefined : 0);
    });
    toggle.addEventListener("click", togglePlay);
    canvas.addEventListener("click", () => { if (state.started) togglePlay(); });

    seek.addEventListener("input", () => {
      state.started = true;
      state.ended = false;
      state.t = Number(seek.value);
      state.offset = state.t;
      if (state.playing) {
        state.clockStart = performance.now();
        if (audio && audio.time() != null) audio.play(state.t);
      }
      build().then(() => { draw(true); setUi(); });
    });

    ccBtn.addEventListener("click", () => {
      state.captions = !state.captions;
      ccBtn.setAttribute("aria-pressed", String(state.captions));
      setUi();
    });
    muteBtn.addEventListener("click", () => {
      state.muted = !state.muted;
      muteBtn.setAttribute("aria-pressed", String(state.muted));
      muteBtn.setAttribute("aria-label", state.muted ? "Unmute" : "Mute");
      if (audio) audio.setMuted(state.muted);
    });

    fig.addEventListener("keydown", (e) => {
      if (e.target === seek && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
      if (e.key === " " || e.key === "k") {
        if (e.target.tagName === "BUTTON" && e.key === " ") return;
        e.preventDefault();
        togglePlay();
      }
    });

    if (root.ResizeObserver) new ResizeObserver(() => { size(); draw(true); }).observe(canvas);
    else root.addEventListener("resize", () => { size(); draw(true); });

    // Build the art and fetch the voiceover as the film comes into view.
    const warm = () => { build(); if (audio) audio.prefetch().catch(() => {}); };
    if (root.IntersectionObserver) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((en) => en.isIntersecting)) { io.disconnect(); warm(); }
      }, { rootMargin: "300px" });
      io.observe(fig);
    } else {
      warm();
    }

    setUi();
    const api = {
      play, pause: () => stop(false), seek: (t) => { seek.value = String(t); seek.dispatchEvent(new Event("input")); },
      get time() { return state.t; }, get playing() { return state.playing; }, get started() { return state.started; },
      renderAt: async (t) => { await build(); state.t = t; draw(true); },
    };
    fig.film = api;
    return api;
  }

  function init() {
    document.querySelectorAll("[data-film]").forEach((fig) => { if (!fig.film) mount(fig); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  root.WordsmithFilm = { mount, init, captionAt, POSTER_T };
})(typeof window !== "undefined" ? window : this);
