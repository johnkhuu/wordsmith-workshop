/*
 * Wordsmith Workshop film: the score, the sound effects and the mix.
 *
 * Every sound is synthesized here in plain JavaScript: plucked ukulele and
 * bass (Karplus-Strong string models), glockenspiel and music box (bell
 * partials), light percussion, and paper/pencil foley. Nothing is licensed
 * or downloaded except the voiceover clips.
 *
 * The same scheduler drives a live AudioContext and an OfflineAudioContext,
 * so the web player and the exported film sound identical.
 */
(function (root) {
  "use strict";
  const K = root.WordsmithFilmKit;
  const S = root.WordsmithFilmScenes;
  const { rng } = K;

  const BPM = 100;
  const BEAT = 60 / BPM;
  const BAR = BEAT * 4;
  const EIGHTH = BEAT / 2;
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ------------------------------------------------------------------
  // DSP building blocks (operate on Float32Arrays)
  // ------------------------------------------------------------------
  function biquad(type, f, q, sr, gainDb) {
    const st = { x1: 0, x2: 0, y1: 0, y2: 0 };
    let b0, b1, b2, a1, a2;
    function set(freq, Q) {
      const w0 = (2 * Math.PI * Math.min(freq, sr * 0.45)) / sr;
      const cos = Math.cos(w0), sin = Math.sin(w0), alpha = sin / (2 * Q);
      let a0;
      if (type === "lowpass") { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; }
      else if (type === "highpass") { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; }
      else if (type === "bandpass") { b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; }
      else { // peaking
        const A = Math.pow(10, (gainDb || 0) / 40);
        b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
      }
      b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    }
    set(f, q);
    return {
      set,
      run(x) {
        const y = b0 * x + b1 * st.x1 + b2 * st.x2 - a1 * st.y1 - a2 * st.y2;
        st.x2 = st.x1; st.x1 = x; st.y2 = st.y1; st.y1 = y;
        return y;
      },
    };
  }

  function normalize(a, peak) {
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
    if (m > 0) for (let i = 0; i < a.length; i++) a[i] *= peak / m;
    return a;
  }

  function fadeEdges(a, sr, fin, fout) {
    const ni = Math.floor(fin * sr), no = Math.floor(fout * sr);
    for (let i = 0; i < ni && i < a.length; i++) a[i] *= i / ni;
    for (let i = 0; i < no && i < a.length; i++) a[a.length - 1 - i] *= i / no;
    return a;
  }

  // ------------------------------------------------------------------
  // Instruments
  // ------------------------------------------------------------------

  // Karplus-Strong plucked string with a fractional-delay allpass for tuning.
  function pluck(sr, freq, dur, o) {
    o = o || {};
    const n = Math.floor(dur * sr);
    const out = new Float32Array(n);
    const period = sr / freq;
    // The loop is N samples long and the averaging filter takes back half a
    // sample (it reads the newer neighbour), so the allpass makes up the
    // rest: N - 0.5 + frac = period, with frac between 1 and 2.
    const N = Math.max(2, Math.floor(period - 0.5));
    const frac = period + 0.5 - N;
    const C = (1 - frac) / (1 + frac);
    const buf = new Float32Array(N);
    const r = rng("ks" + freq.toFixed(2) + (o.seed || ""));
    const bright = o.bright == null ? 0.55 : o.bright;
    let lp = 0;
    for (let i = 0; i < N; i++) { lp += bright * (r() * 2 - 1 - lp); buf[i] = lp; }
    // pluck position: soften the excitation with a comb
    const pick = Math.max(1, Math.floor(N * (o.pick || 0.18)));
    for (let i = N - 1; i >= pick; i--) buf[i] -= buf[i - pick] * 0.6;
    const damp = o.damp == null ? 0.996 : o.damp;
    let idx = 0, apX = 0, apY = 0;
    for (let i = 0; i < n; i++) {
      const cur = buf[idx];
      const nxt = buf[(idx + 1) % N];
      const v = damp * 0.5 * (cur + nxt);
      const y = C * v + apX - C * apY;
      apX = v; apY = y;
      buf[idx] = y;
      out[i] = cur;
      idx = (idx + 1) % N;
    }
    // a little body: gentle low-mid warmth
    const body = biquad("peaking", o.body || 320, 0.9, sr, 3);
    for (let i = 0; i < n; i++) out[i] = body.run(out[i]);
    return fadeEdges(normalize(out, 0.9), sr, 0.002, 0.04);
  }

  // Bells: glockenspiel (bright, long) and music box (soft, short).
  function bell(sr, freq, dur, kind) {
    const parts = kind === "box"
      ? [[1, 1, 0.9], [3.0, 0.14, 0.35], [6.12, 0.05, 0.15]]
      : [[1, 1, 1.6], [2.756, 0.42, 0.55], [5.404, 0.2, 0.28], [8.933, 0.09, 0.14]];
    const n = Math.floor(dur * sr);
    const out = new Float32Array(n);
    const r = rng("bell" + freq);
    const ph = parts.map(() => r() * Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let v = 0;
      for (let k = 0; k < parts.length; k++) {
        const [ratio, amp, dec] = parts[k];
        const f = freq * ratio;
        if (f > sr * 0.45) continue;
        v += amp * Math.exp(-t / dec) * Math.sin(2 * Math.PI * f * t + ph[k]);
      }
      const atk = Math.min(1, t / 0.0025);
      out[i] = v * atk;
    }
    // mallet click
    const clickN = Math.floor(0.004 * sr);
    for (let i = 0; i < clickN && i < n; i++) out[i] += (r() * 2 - 1) * 0.12 * (1 - i / clickN);
    return fadeEdges(normalize(out, 0.9), sr, 0, 0.05);
  }

  function kick(sr) {
    const n = Math.floor(0.42 * sr), out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = 46 + 74 * Math.exp(-t * 26);
      phase += (2 * Math.PI * f) / sr;
      out[i] = Math.sin(phase) * Math.exp(-t * 8.5);
    }
    for (let i = 0; i < 40; i++) out[i] += (i % 2 ? 0.3 : -0.3) * (1 - i / 40);
    return normalize(out, 0.95);
  }

  function snap(sr) {
    const n = Math.floor(0.16 * sr), out = new Float32Array(n);
    const r = rng("snap");
    const bp = biquad("bandpass", 2100, 1.4, sr);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      out[i] = bp.run(r() * 2 - 1) * Math.exp(-t * 42) + 0.25 * Math.sin(2 * Math.PI * 1150 * t) * Math.exp(-t * 70);
    }
    return normalize(out, 0.9);
  }

  function shaker(sr, accent) {
    const n = Math.floor(0.09 * sr), out = new Float32Array(n);
    const r = rng("shk" + accent);
    const hp = biquad("highpass", 5200, 0.8, sr);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      out[i] = hp.run(r() * 2 - 1) * Math.min(1, t / 0.006) * Math.exp(-t * (accent ? 38 : 55));
    }
    return normalize(out, accent ? 0.9 : 0.6);
  }

  function woodblock(sr, high) {
    const f = high ? 1180 : 860;
    const n = Math.floor(0.14 * sr), out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      out[i] = (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2.64 * t)) * Math.exp(-t * 36);
    }
    return normalize(out, 0.9);
  }

  function triangleBell(sr) {
    const n = Math.floor(2.2 * sr), out = new Float32Array(n);
    const parts = [[4180, 1, 1.4], [6230, 0.5, 0.9], [9710, 0.25, 0.5]];
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let v = 0;
      for (const [f, a, d] of parts) v += a * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / d);
      out[i] = v * Math.min(1, t / 0.002);
    }
    return normalize(out, 0.7);
  }

  // ------------------------------------------------------------------
  // Foley
  // ------------------------------------------------------------------
  function noiseShaped(sr, dur, seed, fn) {
    const n = Math.floor(dur * sr), out = new Float32Array(n);
    const r = rng(seed);
    fn(out, n, r);
    return out;
  }

  function paperSlide(sr, dur, seed) {
    return fadeEdges(normalize(noiseShaped(sr, dur, "slide" + seed, (out, n, r) => {
      const bp = biquad("bandpass", 1200, 0.7, sr);
      const lp = biquad("lowpass", 300, 0.7, sr);
      for (let i = 0; i < n; i++) {
        const f = i / n;
        if (i % 64 === 0) bp.set(900 * Math.pow(3, f), 0.7);
        const env = Math.sin(Math.PI * Math.pow(f, 0.6)) ** 1.5;
        const w = r() * 2 - 1;
        out[i] = (bp.run(w) * 0.9 + lp.run(w) * 0.25) * env * (0.75 + 0.25 * r());
      }
    }), 0.8), sr, 0.005, 0.03);
  }

  function pat(sr, seed) {
    return normalize(noiseShaped(sr, 0.09, "pat" + seed, (out, n, r) => {
      const lp = biquad("lowpass", 2600 + r() * 1200, 0.8, sr);
      const body = biquad("bandpass", 700 + r() * 400, 1.2, sr);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const w = r() * 2 - 1;
        out[i] = (lp.run(w) + body.run(w) * 1.6) * Math.exp(-t * 62);
      }
    }), 0.8);
  }

  function flick(sr, seed) {
    return normalize(noiseShaped(sr, 0.16, "flick" + seed, (out, n, r) => {
      const bp = biquad("bandpass", 2000 + r() * 1500, 0.9, sr);
      for (let i = 0; i < n; i++) {
        const f = i / n;
        out[i] = bp.run(r() * 2 - 1) * Math.sin(Math.PI * Math.pow(f, 0.4)) * (1 - f);
      }
    }), 0.7);
  }

  function tapeRip(sr, seed) {
    return normalize(noiseShaped(sr, 0.3, "tape" + seed, (out, n, r) => {
      const hp = biquad("highpass", 1800, 0.7, sr);
      let crack = 0;
      for (let i = 0; i < n; i++) {
        const f = i / n;
        if (r() < 0.02) crack = 1;
        crack *= 0.985;
        out[i] = hp.run(r() * 2 - 1) * (0.35 + crack) * Math.sin(Math.PI * f) ** 0.6;
      }
    }), 0.6);
  }

  // pencil (dry, grainy) or marker (smoother, a hint of squeak)
  function scribble(sr, dur, seed, marker) {
    return fadeEdges(normalize(noiseShaped(sr, dur, "scr" + seed, (out, n, r) => {
      const bp = biquad("bandpass", marker ? 2100 : 3300, marker ? 1.6 : 1.1, sr);
      const hp = biquad("highpass", 1200, 0.7, sr);
      const rate = 10 + r() * 6, ph = r() * 6;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const am = 0.35 + 0.65 * Math.pow(Math.abs(Math.sin(Math.PI * rate * t + ph)), 1.5);
        let v = hp.run(bp.run(r() * 2 - 1)) * am;
        if (marker) v += 0.08 * Math.sin(2 * Math.PI * (1400 + 200 * Math.sin(t * 9)) * t) * am;
        out[i] = v;
      }
    }), 0.55), sr, 0.015, 0.03);
  }

  function crumple(sr, dur) {
    return fadeEdges(normalize(noiseShaped(sr, dur, "crumple", (out, n, r) => {
      const hp = biquad("highpass", 1500, 0.7, sr);
      let i = 0;
      while (i < n) {
        const len = Math.floor(sr * (0.002 + r() * 0.006));
        const amp = 0.3 + r() * 0.7;
        for (let k = 0; k < len && i + k < n; k++) out[i + k] += (r() * 2 - 1) * amp * Math.exp(-k / (len * 0.4));
        i += Math.floor(sr / (110 + r() * 160));
      }
      for (let k = 0; k < n; k++) out[k] = hp.run(out[k]) * Math.sin(Math.PI * k / n) ** 0.5;
    }), 0.75), sr, 0.005, 0.05);
  }

  function whoosh(sr, dur, seed, low) {
    return fadeEdges(normalize(noiseShaped(sr, dur, "wh" + seed, (out, n, r) => {
      const bp = biquad("bandpass", 600, 0.6, sr);
      for (let i = 0; i < n; i++) {
        const f = i / n;
        if (i % 64 === 0) bp.set((low ? 260 : 420) + (low ? 1300 : 2200) * Math.sin(Math.PI * f), 0.6);
        out[i] = bp.run(r() * 2 - 1) * Math.pow(Math.sin(Math.PI * f), 2);
      }
    }), 0.8), sr, 0.01, 0.02);
  }

  function thump(sr) {
    const n = Math.floor(0.5 * sr), out = new Float32Array(n);
    const r = rng("thump");
    const lp = biquad("lowpass", 520, 0.8, sr);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = 44 + 60 * Math.exp(-t * 20);
      phase += (2 * Math.PI * f) / sr;
      const body = Math.sin(phase) * Math.exp(-t * 7);
      const thud = lp.run(r() * 2 - 1) * Math.exp(-t * 30) * 1.6;
      const clack = t < 0.03 ? Math.sin(2 * Math.PI * 1650 * t) * Math.exp(-t * 160) * 0.5 : 0;
      out[i] = body + thud + clack;
    }
    return normalize(out, 0.98);
  }

  function popSfx(sr, seed) {
    const n = Math.floor(0.1 * sr), out = new Float32Array(n);
    const r = rng("pop" + seed);
    const f0 = 760 + r() * 260;
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = f0 * Math.exp(-t * 14) + 240;
      phase += (2 * Math.PI * f) / sr;
      out[i] = Math.sin(phase) * Math.exp(-t * 32) * Math.min(1, t / 0.002);
    }
    return normalize(out, 0.7);
  }

  function beep(sr, f) {
    const n = Math.floor(0.075 * sr), out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      out[i] = (Math.sin(2 * Math.PI * f * t) > 0 ? 1 : -1) * 0.5 * Math.min(1, t / 0.005, (n - i) / sr / 0.01);
    }
    const lp = biquad("lowpass", 3000, 0.7, sr);
    for (let i = 0; i < n; i++) out[i] = lp.run(out[i]);
    return normalize(out, 0.5);
  }

  function swell(sr, dur) {
    return fadeEdges(normalize(noiseShaped(sr, dur, "swell", (out, n, r) => {
      const lp = biquad("lowpass", 300, 0.7, sr);
      for (let i = 0; i < n; i++) {
        const f = i / n;
        if (i % 64 === 0) lp.set(300 + 5200 * f * f, 0.7);
        out[i] = lp.run(r() * 2 - 1) * Math.pow(f, 2.2);
      }
    }), 0.7), sr, 0.02, 0.008);
  }

  // ------------------------------------------------------------------
  // The cue sheet: every note and every sound, with a time and a level.
  // ------------------------------------------------------------------
  const CHORDS = ["F", "Dm", "Bb", "C", "F", "Am", "Bb", "C", "Dm", "Bb", "C", "F"];
  const TONES = { F: [65, 69, 72], Dm: [62, 65, 69], Bb: [62, 65, 70], C: [64, 67, 72], Am: [64, 69, 72] };
  const BASS = { F: [41, 48], Dm: [38, 45], Bb: [46, 41], C: [36, 43], Am: [45, 40] };
  const BOX = [[77, 81, 84, 81], [74, 77, 81, 77], [74, 77, 82, 77], [76, 79, 84, 79]];
  const MELODY = {
    4: [[0, 81], [1, 84], [3, 89], [5, 88], [6, 84]],
    5: [[0, 88], [2, 84], [3, 81], [5, 88], [6, 84]],
    6: [[0, 86], [1, 82], [3, 77], [5, 86], [6, 84], [7, 82]],
    7: [[0, 84], [2, 79], [3, 88], [5, 86], [6, 84]],
    8: [[0, 86], [2, 81], [3, 89], [5, 88], [6, 86]],
    9: [[2, 89], [3, 86], [4, 82], [6, 84]],
  };

  function cueSheet() {
    const ev = [];
    const add = (t, inst, o) => ev.push(Object.assign({ t, inst }, o));
    for (let bar = 0; bar < 12; bar++) {
      const b0 = bar * BAR;
      const ch = CHORDS[bar];
      const groove = bar >= 4;
      const [root, fifth] = BASS[ch];
      // bass
      if (bar === 11) add(b0, "bass", { note: root, dur: 3.2, gain: 0.62 });
      else if (bar === 9) {
        add(b0, "bass", { note: root, dur: 1.4, gain: 0.6 });
        add(b0 + 2 * BEAT, "bass", { note: fifth, dur: 1.2, gain: 0.45 });
      } else {
        add(b0, "bass", { note: root, dur: groove ? 1.0 : 1.3, gain: 0.55 });
        add(b0 + 2 * BEAT, "bass", { note: fifth, dur: groove ? 0.9 : 1.2, gain: 0.45 });
        if (groove) add(b0 + 3.5 * BEAT, "bass", { note: root + 12, dur: 0.35, gain: 0.32 });
      }
      // ukulele
      const tones = TONES[ch];
      if (bar === 11) {
        tones.concat([tones[0] + 12]).forEach((m, k) => add(b0 + k * 0.028, "uke", { note: m, dur: 3.2, gain: 0.3, damp: 0.998 }));
      } else if (!groove) {
        [1, 3].forEach((bt) => tones.forEach((m, k) => add(b0 + bt * BEAT + k * 0.012, "uke", { note: m, dur: 0.22, gain: 0.16, damp: 0.965, chop: true })));
      } else {
        const pattern = [[0, "D"], [2, "D"], [3, "U"], [5, "U"], [6, "D"], [7, "U"]];
        pattern.forEach(([e, dir]) => {
          if (bar === 9 && e < 2) return; // stop-time under the stamp
          const order = dir === "D" ? tones : tones.slice().reverse();
          order.forEach((m, k) => add(b0 + e * EIGHTH + k * 0.011, "uke", { note: m, dur: 0.7, gain: dir === "D" ? 0.15 : 0.1, damp: 0.991 }));
        });
      }
      // music box in the opening, glockenspiel melody after
      if (bar < 4) BOX[bar].forEach((m, k) => add(b0 + k * 2 * EIGHTH, "box", { note: m, dur: 1.2, gain: 0.13 }));
      if (MELODY[bar]) MELODY[bar].forEach(([e, m]) => add(b0 + e * EIGHTH, "glock", { note: m, dur: 1.6, gain: 0.16 }));
      // percussion
      if (!groove) {
        for (let bt = 0; bt < 4; bt++) add(b0 + bt * BEAT, "wood", { high: bt % 2 === 0, gain: 0.07 });
      } else if (bar < 11) {
        for (let e = 0; e < 8; e++) {
          if (bar === 9 && e < 2) continue;
          add(b0 + e * EIGHTH + (e % 2 ? 0.018 : 0), "shaker", { accent: e % 2 === 1, gain: 0.07 });
          if (e === 0 || e === 4) add(b0 + e * EIGHTH, "kick", { gain: bar === 10 ? 0.32 : 0.4 });
          if (e === 2 || e === 6) add(b0 + e * EIGHTH, "snap", { gain: 0.17 });
        }
      }
    }
    // the harp-like run as the pencil arrives
    [65, 67, 69, 70, 72, 74, 76, 77, 79, 81, 82, 84, 86, 88, 89].forEach((m, k) =>
      add(S.T.pencilIn - 0.05 + k * 0.026, "uke", { note: m, dur: 1.2, gain: 0.09, damp: 0.997, seed: "harp" }));
    // title letters: one glockenspiel note each, climbing the C pentatonic
    const penta = [72, 74, 76, 79, 81, 84, 86, 88, 91, 76, 79, 81, 84, 86, 88, 91, 93];
    penta.forEach((m, i) => add(S.T.letters + i * S.T.letterGap + (i >= 9 ? 0.12 : 0), "glock", { note: m, dur: 1.0, gain: 0.085 }));
    // final flourish
    [89, 93, 96, 101].forEach((m, k) => add(11 * BAR + k * 0.075, "glock", { note: m, dur: 2.4, gain: 0.12 }));
    add(11 * BAR + 0.05, "triangle", { gain: 0.05 });
    add(26.4, "kick", { gain: 0.35 });
    // twinkles on the stars and a wink
    [22.55, 22.67, 22.79, 22.91, 23.03].forEach((t, i) => add(t, "glock", { note: [96, 100, 103, 98, 101][i], dur: 0.8, gain: 0.04 }));
    [27.2, 27.35, 27.5, 27.65].forEach((t, i) => add(t, "glock", { note: [96, 101, 100, 105][i], dur: 0.9, gain: 0.035 }));
    add(28.1, "glock", { note: 108, dur: 0.7, gain: 0.04 });

    // ---- foley ----
    const T = S.T;
    const sfx = (t, kind, o) => add(t, "sfx:" + kind, Object.assign({ gain: 0.5, pan: 0 }, o));
    sfx(T.cardIn, "slide", { dur: 0.42, gain: 0.55 });
    sfx(0.3, "pat", { gain: 0.3, pan: -0.6 });
    sfx(T.cardIn + 0.35, "tape", { gain: 0.32, pan: -0.4 });
    sfx(T.cardIn + 0.45, "tape", { gain: 0.3, pan: 0.4 });
    for (let i = 0; i < 8; i++) sfx(T.copies + i * 0.12, "flick", { seed: i, gain: 0.26, pan: i % 2 ? 0.5 : -0.5 });
    sfx(1.75, "pat", { gain: 0.32, pan: 0.6 });
    sfx(T.botIn, "pop", { gain: 0.32, pan: 0.6 });
    sfx(T.botIn + 0.08, "beep", { f: 1250, gain: 0.12, pan: 0.6 });
    sfx(T.botIn + 0.17, "beep", { f: 940, gain: 0.12, pan: 0.6 });
    S.WORD_TIMES.forEach((t, i) => sfx(t, "pat", { seed: "w" + i, gain: 0.2, pan: -0.3 + (i % 7) * 0.1 }));
    sfx(T.circles, "marker", { dur: 0.5, gain: 0.3 });
    sfx(T.circles + 0.55, "marker", { dur: 0.3, gain: 0.28, pan: 0.3 });
    sfx(T.circles + 0.85, "marker", { dur: 0.3, gain: 0.28, pan: -0.3 });
    [0.35, 0.75, 1.05].forEach((d, i) => sfx(T.circles + d, "pat", { seed: "lbl" + i, gain: 0.24, pan: [-0.7, 0.7, -0.4][i] }));
    sfx(T.dolls, "slide", { dur: 0.6, gain: 0.45, seed: "dolls" });
    sfx(T.pencilIn, "whoosh", { dur: 0.45, gain: 0.4, pan: 0.6 });
    for (let i = 0; i < 4; i++) sfx(T.strike + i * 0.2, "pencil", { dur: 0.18, gain: 0.34, seed: "st" + i });
    sfx(T.crumple, "crumple", { dur: 0.38, gain: 0.42 });
    sfx(T.toss, "whoosh", { dur: 0.45, gain: 0.32, pan: -0.6, seed: "toss" });
    sfx(T.point + 0.05, "whoosh", { dur: 0.25, gain: 0.22, seed: "drop", low: true });
    sfx(T.point + 0.28, "thump", { gain: 0.26 });
    sfx(T.point + 0.28, "pat", { gain: 0.36, seed: "slap" });
    sfx(T.point + 0.3, "pat", { gain: 0.24, seed: "pl", pan: -0.7 });
    sfx(T.details, "slide", { dur: 0.26, gain: 0.34, pan: -0.5, seed: "d1" });
    sfx(T.details + 0.25, "slide", { dur: 0.26, gain: 0.34, pan: 0.5, seed: "d2" });
    sfx(T.connect, "pencil", { dur: 0.18, gain: 0.26, seed: "cn1", pan: -0.2 });
    sfx(T.connect + 0.18, "pencil", { dur: 0.18, gain: 0.26, seed: "cn2", pan: 0.2 });
    sfx(14.05, "pencil", { dur: 0.25, gain: 0.2, seed: "br" });
    sfx(14.15, "pat", { gain: 0.24, seed: "rd" });
    sfx(T.polaroid, "pop", { gain: 0.3, pan: 0.7, seed: "pol" });
    sfx(T.polaroid + 0.2, "tape", { gain: 0.24, pan: 0.7, seed: "pt" });
    sfx(14.85, "whoosh", { dur: 0.4, gain: 0.3, seed: "up" });
    sfx(T.noteIn, "slide", { dur: 0.4, gain: 0.45, seed: "note" });
    sfx(T.noteIn + 0.3, "tape", { gain: 0.26, seed: "nt" });
    T.methods.forEach((t, i) => {
      const side = i < 3 ? -0.7 : 0.7;
      sfx(t, "slide", { dur: 0.22, gain: 0.26, pan: side, seed: "m" + i });
      sfx(t + 0.2, "pat", { gain: 0.3, pan: side, seed: "mp" + i });
    });
    sfx(T.lens, "whoosh", { dur: 0.35, gain: 0.22, pan: 0.6, seed: "lens" });
    sfx(T.lens + 0.2, "pop", { gain: 0.24, seed: "tag" });
    T.sweeps.forEach(([, b], i) => sfx(b, "tick", { gain: 0.3, pan: 0.4, seed: "ck" + i }));
    sfx(T.stamp - 0.3, "whoosh", { dur: 0.3, gain: 0.25, seed: "stampdown", low: true });
    sfx(T.stamp, "thump", { gain: 0.62 });
    sfx(22.05, "whoosh", { dur: 0.4, gain: 0.28, seed: "clear" });
    sfx(T.you, "pop", { gain: 0.34, pan: -0.6, seed: "you" });
    sfx(T.you + 0.35, "pat", { gain: 0.26, pan: -0.7, seed: "youlbl" });
    sfx(T.wipe - 0.55, "swell", { dur: 0.6, gain: 0.22 });
    sfx(T.wipe, "whoosh", { dur: 0.6, gain: 0.42, low: true, seed: "wipe" });
    sfx(T.wipe + 0.3, "tape", { gain: 0.3, seed: "rip" });
    for (let i = 0; i < 17; i++) sfx(T.letters + i * T.letterGap + (i >= 9 ? 0.12 : 0), "pat", { gain: 0.14, seed: "L" + i, pan: -0.5 + (i % 9) * 0.12 });
    sfx(T.tagline, "pencil", { dur: T.taglineEnd - T.tagline, gain: 0.26, seed: "tagline" });
    sfx(T.taglineEnd, "marker", { dur: 0.3, gain: 0.2, seed: "ul" });
    sfx(T.cta, "pop", { gain: 0.26, seed: "cta1" });
    sfx(T.cta + 0.25, "pop", { gain: 0.26, seed: "cta2" });
    sfx(T.cta + 0.35, "tape", { gain: 0.2, seed: "ctat" });
    ev.sort((a, b) => a.t - b.t);
    return ev;
  }

  // ------------------------------------------------------------------
  // Turning cues into buffers (cached per context)
  // ------------------------------------------------------------------
  const keyOf = (e) => e.inst + ":" + JSON.stringify([e.note, e.dur, e.damp, e.seed, e.accent, e.high, e.f, e.low]);

  // Raw sample data, made ahead of time so pressing play doesn't wait on synthesis.
  // Keyed by sample rate, then by sound.
  const ARRAYS = new Map();

  function synthData(sr, e) {
    let data;
    switch (e.inst) {
      case "bass": data = pluck(sr, hz(e.note), e.dur, { bright: 0.28, damp: 0.995, pick: 0.3, body: 140, seed: "bass" }); break;
      case "uke": data = pluck(sr, hz(e.note), e.dur, { bright: e.chop ? 0.45 : 0.62, damp: e.damp || 0.992, pick: 0.16, body: 420, seed: e.seed || "uke" }); break;
      case "glock": data = bell(sr, hz(e.note), e.dur, "glock"); break;
      case "box": data = bell(sr, hz(e.note), e.dur, "box"); break;
      case "kick": data = kick(sr); break;
      case "snap": data = snap(sr); break;
      case "shaker": data = shaker(sr, e.accent); break;
      case "wood": data = woodblock(sr, e.high); break;
      case "triangle": data = triangleBell(sr); break;
      case "sfx:slide": data = paperSlide(sr, e.dur, e.seed || ""); break;
      case "sfx:pat": data = pat(sr, e.seed || ""); break;
      case "sfx:flick": data = flick(sr, e.seed || ""); break;
      case "sfx:tape": data = tapeRip(sr, e.seed || ""); break;
      case "sfx:pencil": data = scribble(sr, e.dur, e.seed || "", false); break;
      case "sfx:marker": data = scribble(sr, e.dur, e.seed || "m", true); break;
      case "sfx:crumple": data = crumple(sr, e.dur); break;
      case "sfx:whoosh": data = whoosh(sr, e.dur, e.seed || "", e.low); break;
      case "sfx:thump": data = thump(sr); break;
      case "sfx:pop": data = popSfx(sr, e.seed || ""); break;
      case "sfx:tick": data = scribble(sr, 0.07, "tick" + (e.seed || ""), false); break;
      case "sfx:beep": data = beep(sr, e.f); break;
      case "sfx:swell": data = swell(sr, e.dur); break;
      default: return null;
    }
    return data;
  }

  // Synthesize every sound for a sample rate in small chunks, yielding between
  // them so the page stays responsive. Safe to call more than once.
  const preparing = new Map();
  function prepare(sr) {
    if (preparing.has(sr)) return preparing.get(sr);
    const store = ARRAYS.get(sr) || new Map();
    ARRAYS.set(sr, store);
    const todo = [];
    const seen = new Set();
    for (const e of cueSheet()) {
      const k = keyOf(e);
      if (!seen.has(k) && !store.has(k)) { seen.add(k); todo.push([k, e]); }
    }
    const p = (async () => {
      for (let i = 0; i < todo.length; i++) {
        const [k, e] = todo[i];
        store.set(k, synthData(sr, e));
        if (i % 12 === 11) await new Promise((r) => setTimeout(r, 0));
      }
    })();
    preparing.set(sr, p);
    return p;
  }

  // Sounds are always made at 48 kHz; Web Audio resamples each buffer to the
  // device's rate on playback, so one idle pre-synthesis covers every device.
  const SYNTH_RATE = 48000;

  function synth(ac, cache, e) {
    const sr = SYNTH_RATE;
    const key = keyOf(e);
    if (cache.has(key)) return cache.get(key);
    const store = ARRAYS.get(sr);
    const data = (store && store.get(key)) || synthData(sr, e);
    if (!data) return null;
    const buf = ac.createBuffer(1, data.length, sr);
    buf.copyToChannel(data, 0);
    cache.set(key, buf);
    return buf;
  }

  function impulse(ac) {
    const sr = ac.sampleRate, n = Math.floor(2.1 * sr);
    const buf = ac.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const r = rng("ir" + ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const cut = 0.55 - 0.45 * Math.min(1, t / 1.6);
        lp += cut * (r() * 2 - 1 - lp);
        d[i] = lp * Math.exp(-t * 3.1) * (t < 0.012 ? 0 : 1);
      }
      [0.017, 0.029, 0.041, 0.058].forEach((tt, k) => { const i = Math.floor((tt + ch * 0.003) * sr); d[i] += 0.5 / (k + 1); });
    }
    return buf;
  }

  // ------------------------------------------------------------------
  // The mix
  // ------------------------------------------------------------------
  function buildGraph(ac) {
    const g = {};
    g.master = ac.createGain(); g.master.gain.value = 0.92;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.2;
    const limit = ac.createDynamicsCompressor();
    limit.threshold.value = -2.5; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = 0.08;
    // trim to a web-video level (about -15 LUFS), then the mute switch
    const trim = ac.createGain(); trim.gain.value = 0.7;
    g.out = ac.createGain();
    g.master.connect(comp); comp.connect(limit); limit.connect(trim); trim.connect(g.out); g.out.connect(ac.destination);

    g.reverb = ac.createConvolver(); g.reverb.buffer = impulse(ac);
    const revOut = ac.createGain(); revOut.gain.value = 0.55;
    g.reverb.connect(revOut); revOut.connect(g.master);

    g.music = ac.createGain(); g.music.gain.value = 0.78;
    const musicTone = ac.createBiquadFilter(); musicTone.type = "highshelf"; musicTone.frequency.value = 6000; musicTone.gain.value = -2;
    g.music.connect(musicTone); musicTone.connect(g.master);
    const musicSend = ac.createGain(); musicSend.gain.value = 0.28; g.music.connect(musicSend); musicSend.connect(g.reverb);

    g.sfx = ac.createGain(); g.sfx.gain.value = 0.72; g.sfx.connect(g.master);
    const sfxSend = ac.createGain(); sfxSend.gain.value = 0.1; g.sfx.connect(sfxSend); sfxSend.connect(g.reverb);

    g.narr = ac.createGain(); g.narr.gain.value = 1.0; g.narr.connect(g.master);
    const narrSend = ac.createGain(); narrSend.gain.value = 0.06; g.narr.connect(narrSend); narrSend.connect(g.reverb);

    // the chatbot through a small, tinny speaker
    g.bot = ac.createGain(); g.bot.gain.value = 1.05;
    const hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 420; hp.Q.value = 0.7;
    const pk = ac.createBiquadFilter(); pk.type = "peaking"; pk.frequency.value = 1900; pk.Q.value = 1.1; pk.gain.value = 6;
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3600; lp.Q.value = 0.9;
    const shaper = ac.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8); }
    shaper.curve = curve;
    g.bot.connect(hp); hp.connect(pk); pk.connect(lp); lp.connect(shaper); shaper.connect(g.master);
    const botSend = ac.createGain(); botSend.gain.value = 0.05; shaper.connect(botSend); botSend.connect(g.reverb);
    return g;
  }

  // Schedule everything from `offset` (seconds into the film) at context time `when`.
  function schedule(ac, g, cache, vo, when, offset) {
    const sources = [];
    const at = (t) => when + (t - offset);
    for (const e of cueSheet()) {
      if (e.t < offset - 0.02) continue;
      const buf = synth(ac, cache, e);
      if (!buf) continue;
      const src = ac.createBufferSource();
      src.buffer = buf;
      const gain = ac.createGain();
      gain.gain.value = e.gain;
      let node = gain;
      if (e.pan) {
        const p = ac.createStereoPanner ? ac.createStereoPanner() : null;
        if (p) { p.pan.value = e.pan; gain.connect(p); node = p; }
      }
      src.connect(gain);
      node.connect(e.inst.startsWith("sfx:") ? g.sfx : g.music);
      src.start(Math.max(when, at(e.t)));
      sources.push(src);
    }
    // voiceover, and the music ducking under it
    g.music.gain.cancelScheduledValues(when);
    g.music.gain.setValueAtTime(0.78, when);
    g.sfx.gain.cancelScheduledValues(when);
    g.sfx.gain.setValueAtTime(0.72, when);
    for (const c of S.CUES) {
      const buf = vo && vo[c.id];
      if (!buf) continue;
      const end = c.at + buf.duration;
      if (end <= offset) continue;
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(c.voice === "bot" ? g.bot : g.narr);
      const startIn = Math.max(0, offset - c.at);
      src.start(Math.max(when, at(c.at)), startIn);
      sources.push(src);
      const duckTo = c.voice === "bot" ? 0.2 : 0.17;
      const d0 = Math.max(when, at(c.at - 0.12));
      const d1 = Math.max(when, at(end + 0.05));
      g.music.gain.setTargetAtTime(duckTo, d0, 0.05);
      g.music.gain.setTargetAtTime(0.78, d1, 0.18);
      g.sfx.gain.setTargetAtTime(0.42, d0, 0.04);
      g.sfx.gain.setTargetAtTime(0.72, d1, 0.12);
    }
    return sources;
  }

  // ------------------------------------------------------------------
  // Loading the voiceover
  // ------------------------------------------------------------------
  function fetchVo(base) {
    return Promise.all(S.CUES.map((c) =>
      fetch(base + c.id + ".mp3").then((r) => {
        if (!r.ok) throw new Error("Couldn't load the voiceover (" + c.id + ")");
        return r.arrayBuffer();
      }).then((ab) => [c.id, ab])));
  }

  function decodeAll(ac, raw) {
    return Promise.all(raw.map(([id, ab]) => new Promise((resolve, reject) => {
      const copy = ab.slice(0);
      const p = ac.decodeAudioData(copy, (b) => resolve([id, b]), reject);
      if (p && p.then) p.then((b) => resolve([id, b]), reject);
    }))).then((pairs) => Object.fromEntries(pairs));
  }

  // ------------------------------------------------------------------
  // Live playback
  // ------------------------------------------------------------------
  function createPlayer(base) {
    let ac = null, g = null, vo = null, raw = null, sources = [], startedAt = 0, startOffset = 0, playing = false, muted = false;
    const cache = new Map();
    const AC = root.AudioContext || root.webkitAudioContext;

    // Fetch the voice clips and synthesize the score at the most common
    // sample rate while the page is idle, before anyone presses play.
    function prefetch() {
      if (!raw) raw = fetchVo(base).catch((e) => { raw = null; throw e; });
      prepare(SYNTH_RATE);
      return raw;
    }

    // Must run inside the click or key handler, before any await: browsers
    // (Safari especially) only let audio start from a user gesture.
    function unlock() {
      if (!AC) return;
      if (!ac) {
        ac = new AC({ latencyHint: "playback" });
        g = buildGraph(ac);
        g.out.gain.value = muted ? 0 : 1;
      }
      if (ac.state === "suspended") ac.resume();
    }

    async function ensure() {
      if (!AC) return false;
      unlock();
      if (ac.state === "suspended") await ac.resume();
      if (!vo) vo = await decodeAll(ac, await prefetch());
      await prepare(SYNTH_RATE);
      return true;
    }

    function stopAll() {
      sources.forEach((s) => { try { s.stop(); } catch (e) { /* already stopped */ } });
      sources = [];
    }

    return {
      prefetch,
      unlock,
      ensure,
      get available() { return !!AC; },
      play(offset) {
        if (!ac) return;
        stopAll();
        const when = ac.currentTime + 0.08;
        sources = schedule(ac, g, cache, vo, when, offset);
        startedAt = when; startOffset = offset; playing = true;
      },
      pause() { stopAll(); playing = false; },
      time() { return playing && ac ? Math.max(startOffset, startOffset + ac.currentTime - startedAt) : null; },
      setMuted(m) {
        muted = m;
        if (g) g.out.gain.setTargetAtTime(m ? 0 : 1, ac.currentTime, 0.02);
      },
    };
  }

  // ------------------------------------------------------------------
  // Offline render (for the MP4 export and for checking levels)
  // ------------------------------------------------------------------
  async function renderOffline(base, sampleRate, stems) {
    const sr = sampleRate || 48000;
    const len = Math.ceil(S.DURATION * sr);
    const OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    const ac = new OAC(2, len, sr);
    const vo = await decodeAll(ac, await fetchVo(base));
    const g = buildGraph(ac);
    if (stems) {
      if (!stems.music) g.music.disconnect();
      if (!stems.sfx) g.sfx.disconnect();
      if (!stems.vo) { g.narr.disconnect(); g.bot.disconnect(); }
    }
    schedule(ac, g, new Map(), vo, 0, 0);
    return ac.startRendering();
  }

  root.WordsmithFilmAudio = { createPlayer, renderOffline, cueSheet, prepare, BPM, _dsp: { pluck, bell, hz } };
})(typeof window !== "undefined" ? window : this);
