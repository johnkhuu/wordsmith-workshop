/*
 * Wordsmith Workshop film: the timeline and the scenes.
 *
 * renderFrame(ctx, t) draws the film at time t (seconds) on a 1920x1080
 * canvas. It's a pure function of t, so playback, seeking, captions and the
 * MP4 export all agree with the audio clock.
 *
 * The picture moves "on twos": poses change 12 times a second, like a
 * stop-motion collage, and hand-drawn lines boil between poses.
 */
(function (root) {
  "use strict";
  const K = root.WordsmithFilmKit;
  const { W, H, C, F, rng, clamp, lerp, prog, ease, place, sketch, tape } = K;

  const FPS = 12;
  const MAT_INK = "#F6F1E3";
  const DURATION = 29.5;

  // Voiceover cues. `at` is when the line starts; `dur` comes from
  // assets/film/vo/durations.json (checked by the unit tests).
  const CUES = [
    { id: "n1", voice: "narrator", at: 0.55, dur: 2.11, text: "You've read this email a thousand times." },
    { id: "b1", voice: "bot", at: 2.95, dur: 2.23, text: "I hope this message finds you well!" },
    { id: "b2", voice: "bot", at: 5.40, dur: 2.54, text: "Your kindness is a vibrant testament." },
    { id: "n2", voice: "narrator", at: 8.25, dur: 1.80, text: "Words that could belong to anyone." },
    { id: "n3", voice: "narrator", at: 10.45, dur: 4.20, text: "Wordsmith Workshop puts your point first, and backs it with real details." },
    { id: "n4", voice: "narrator", at: 15.00, dur: 2.98, text: "It shapes each piece with methods real editors use," },
    { id: "n5", voice: "narrator", at: 18.10, dur: 3.41, text: "then checks every line for the tells that give a chatbot away." },
    { id: "n6", voice: "narrator", at: 22.30, dur: 1.27, text: "Now it sounds like you." },
    { id: "n7", voice: "narrator", at: 24.20, dur: 2.52, text: "Wordsmith Workshop. Lead with the point." },
  ];

  // Moments the sound design hangs on.
  const T = {
    cardIn: 0.15, copies: 1.05, botIn: 2.75,
    circles: 8.30, dolls: 9.0,
    pencilIn: 10.40, strike: 10.95, crumple: 11.80, toss: 12.05,
    point: 12.30, details: 13.40, connect: 13.92, polaroid: 14.25,
    noteIn: 15.0, methods: [15.6, 15.9, 16.2, 16.5, 16.8, 17.1],
    lens: 18.15, sweeps: [[18.45, 18.95], [19.0, 19.75], [19.8, 20.5], [20.55, 21.2]],
    stamp: 21.60, you: 22.30, wipe: 23.55,
    letters: 24.20, letterGap: 0.062, tagline: 25.55, taglineEnd: 26.45, cta: 26.85,
  };

  const BOT_WORDS = [
    { cue: "b1", words: ["I", "hope", "this", "message", "finds", "you", "well!"], syl: [1, 1, 1, 2, 1, 1, 1.4] },
    { cue: "b2", words: ["Your", "kindness", "is", "a", "vibrant", "testament."], syl: [1, 2, 1, 0.6, 2, 3] },
  ];

  const METHODS = [
    { title: "Pyramid Principle", by: "Barbara Minto", icon: "pyramid" },
    { title: "SCQA", by: "Barbara Minto", icon: "scqa" },
    { title: "MECE", by: "Barbara Minto", icon: "mece" },
    { title: "Inverted Pyramid", by: "newsrooms", icon: "inverted" },
    { title: "Writing Without Bullshit", by: "Josh Bernoff", icon: "wwb" },
    { title: "Storytelling with Data", by: "Cole N. Knaflic", icon: "data" },
  ];
  const METHOD_SPOTS = [
    [250, 270, -0.06, -1], [225, 545, 0.05, -1], [258, 815, -0.04, -1],
    [1700, 270, 0.06, 1], [1712, 545, -0.05, 1], [1690, 815, 0.04, 1],
  ];

  const NOTE_LINES = [
    { text: "Hi Dana,", y: 120, hand: true },
    { text: "Thanks for watching Biscuit last weekend.", y: 222 },
    { text: "He came home tired and happy.", y: 302 },
    { text: "We had your tomatoes on toast Sunday.", y: 382 },
    { text: "Sam", y: 492, hand: true },
  ];

  // ------------------------------------------------------------------
  // Assets: built once, after the web fonts are ready.
  // (wordTimes is defined below; WORD_TIMES is filled in at the end of the file.)
  // ------------------------------------------------------------------
  let A = null;

  function wordTimes(group) {
    const cue = CUES.find((c) => c.id === group.cue);
    const total = group.syl.reduce((a, b) => a + b, 0);
    const span = cue.dur * 0.86;
    let acc = 0;
    return group.syl.map((s) => {
      const at = cue.at + 0.04 + (acc / total) * span;
      acc += s;
      return at;
    });
  }

  function build() {
    const a = {};
    a.bg = K.matTexture(W + 120, H + 120);
    // handwritten notes on paper scraps, so they read on the dark mat
    a.lbl = {
      fig: K.scrapLabel("fig. 1: the usual email", { size: 40, base: "#E9DFC1", color: C.inkSoft, torn: { left: true, right: true } }),
      thousand: K.scrapLabel("×1,000", { size: 78, color: C.redInk }),
      opener: K.scrapLabel("stock opener", { size: 50, color: C.redInk }),
      brochure: K.scrapLabel("brochure word", { size: 50, color: C.redInk }),
      puffery: K.scrapLabel("puffery", { size: 50, color: C.redInk }),
      beep: K.scrapLabel("beep boop", { size: 36, color: C.inkSoft }),
      point: K.scrapLabel("the point", { size: 62, base: C.yellow, color: C.pencil }),
      details: K.scrapLabel("real details", { size: 62, base: C.yellow, color: C.pencil }),
      you: K.scrapLabel("you!", { size: 70, color: C.redInk }),
    };

    // The email card and the clichés pasted onto it, word by word.
    const cardW = 1100, cardH = 540;
    a.cardTex = K.paperTexture(cardW, cardH, { base: C.card, rules: 66, rulesTop: 104, marginX: 92, seed: "card" });
    const header = (g) => {
      g.font = K.font(F.type, 26, 700); g.fillStyle = C.inkSoft;
      g.fillText("To: Dana", 116, 62);
      g.fillText("Re: Thank you!!", 330, 62);
    };
    a.card = K.sprite(cardW, cardH, { seed: "cardsp", texture: a.cardTex, draw: header });

    const words = [];
    BOT_WORDS.forEach((grp, gi) => {
      const times = wordTimes(grp);
      grp.words.forEach((w, wi) => {
        const style = (gi * 3 + wi * 5 + (w === "vibrant" ? 2 : 0)) % 7;
        words.push({ text: w, at: times[wi], spr: K.clipping(w, `${gi}-${wi}-${w}`, style), group: gi, index: wi });
      });
    });
    // Lay the words out in lines inside the card.
    const r = rng("layout");
    let x = 128, row = 0;
    const rowY = [146, 252, 358, 456];
    const scale = 0.84;
    words.forEach((wd, i) => {
      const ww = wd.spr.w * scale;
      const newGroup = i > 0 && wd.group !== words[i - 1].group;
      if (newGroup || x + ww > cardW - 40) { row += 1; x = 128; }
      wd.lx = x + ww / 2 + (r() - 0.5) * 6;
      wd.ly = rowY[row] + (r() - 0.5) * 10;
      wd.rot = (r() - 0.5) * 0.09;
      wd.scale = scale;
      x += ww + 12 + r() * 8;
    });
    a.words = words;

    // Photocopies of the finished email: grey, a bit contrasty, toner specks.
    a.copy = K.sprite(cardW, cardH, {
      seed: "copysp",
      texture: a.cardTex,
      draw: (g) => {
        header(g);
        words.forEach((wd) => {
          g.save(); g.translate(wd.lx, wd.ly); g.rotate(wd.rot); g.scale(wd.scale, wd.scale);
          g.drawImage(wd.spr.canvas, -wd.spr.w / 2 - wd.spr.pad, -wd.spr.h / 2 - wd.spr.pad);
          g.restore();
        });
        const img = g.getImageData(0, 0, cardW, cardH);
        const d = img.data;
        const rr = rng("toner");
        for (let i = 0; i < d.length; i += 4) {
          let v = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
          v = clamp((v - 128) * 1.25 + 140, 0, 255);
          if (rr() < 0.0015) v *= 0.4;
          d[i] = v; d[i + 1] = v; d[i + 2] = v * 0.98;
        }
        g.putImageData(img, 0, 0);
      },
    });

    a.botOpen = K.botSticker(true);
    a.botShut = K.botSticker(false);
    a.dolls = K.dollChain(7, { scale: 1.0 });
    a.ball = K.paperBall(92, "ball");
    a.you = K.youDoll(1.6);
    a.polaroid = K.polaroid();

    // The pyramid: the point on top, the details under it.
    a.point = K.sprite(820, 140, {
      seed: "point",
      tex: { base: C.pencil, seed: "pointtex" },
      torn: { bottom: true },
      draw: (g, w, h) => {
        g.font = K.font(F.display, 60, 400); g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText("Thanks for watching Biscuit!", w / 2, h / 2 + 4);
      },
    });
    const detail = (text, seed) => K.sprite(600, 124, {
      seed,
      tex: { base: C.card, rules: 40, rulesTop: 30, seed: seed + "t" },
      draw: (g, w, h) => {
        g.font = K.font(F.type, 34, 700); g.fillStyle = C.ink; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(text, w / 2, h / 2 + 2);
      },
    });
    a.detailA = detail("He came home tired & happy.", "detA");
    a.detailB = detail("We had your tomatoes.", "detB");

    // The rewritten note.
    const noteW = 980, noteH = 600;
    a.note = K.sprite(noteW, noteH, {
      seed: "note",
      tex: { base: C.card, rules: 80, rulesTop: 140, marginX: 70, seed: "notetex" },
      draw: (g) => {
        NOTE_LINES.forEach((ln) => {
          if (ln.hand) { g.font = K.font(F.hand, 60, 700); g.fillStyle = C.pencilDark; }
          else { g.font = K.font(F.type, 33, 700); g.fillStyle = C.ink; }
          g.fillText(ln.text, 100, ln.y);
        });
      },
    });

    a.methods = METHODS.map((m, i) => K.sprite(346, 206, {
      seed: "m" + i,
      tex: { base: i % 2 ? C.card : "#FFFBEF", rules: 38, rulesTop: 78, marginX: 28, seed: "mt" + i },
      draw: (g, w) => {
        const long = m.title.length > 15;
        g.font = K.font(F.type, long ? 27 : 32, 700); g.fillStyle = C.ink;
        const words = m.title.split(" ");
        if (long) {
          const mid = Math.ceil(words.length / 2);
          g.fillText(words.slice(0, mid).join(" "), 46, 58);
          g.fillText(words.slice(mid).join(" "), 46, 92);
        } else {
          g.fillText(m.title, 46, 66);
        }
        g.font = K.font(F.hand, 34, 700); g.fillStyle = C.pencil;
        g.fillText(m.by, 46, 172);
        K.methodIcon(g, m.icon, m.icon === "scqa" ? w - 76 : w - 64, m.icon === "scqa" ? 62 : 150);
      },
    }));

    a.tellTag = K.sprite(350, 74, {
      seed: "telltag",
      tex: { base: C.kraft, seed: "kraftt" },
      torn: { left: true },
      draw: (g, w, h) => {
        g.font = K.font(F.type, 28, 700); g.fillStyle = C.ink; g.textBaseline = "middle";
        g.fillText("AI tells found: 0", 26, h / 2 + 2);
      },
    });
    a.stamp = K.stampImpression("0 AI TELLS", "CHECKED LINE BY LINE", "rgba(36,80,192,0.92)");

    // The title card: a yellow legal-pad page torn from the pad.
    a.legal = K.sprite(W + 160, H + 40, {
      seed: "legal",
      tex: { base: C.legal, rules: 60, rulesTop: 120, marginX: 210, doubleMargin: true, ruleColor: "#9EB7DE", seed: "legaltex" },
      torn: { left: true },
      rough: 1.6,
      shadowBlur: 30,
    });
    a.letters = [];
    const t1 = "WORDSMITH", t2 = "WORKSHOP";
    [t1, t2].forEach((word, wi) => {
      word.split("").forEach((ch, ci) => a.letters.push({ ch, row: wi, col: ci, spr: K.letterScrap(ch, `${wi}-${ci}-${ch}`) }));
    });
    const lr = rng("letters");
    [0, 1].forEach((row) => {
      const ls = a.letters.filter((l) => l.row === row);
      const total = ls.reduce((s, l) => s + l.spr.w * 0.96 + 6, 0);
      let lx = W / 2 - total / 2;
      ls.forEach((l) => {
        l.x = lx + (l.spr.w * 0.96) / 2;
        l.y = (row ? 476 : 300) + (lr() - 0.5) * 18;
        l.rot = (lr() - 0.5) * 0.2;
        lx += l.spr.w * 0.96 + 6;
      });
    });
    a.letters.forEach((l, i) => { l.at = T.letters + i * T.letterGap + (l.row ? 0.12 : 0); });

    a.cta1 = K.sprite(640, 84, {
      seed: "cta1", torn: { left: true, right: true }, rough: 0.8,
      tex: { base: C.white, seed: "cta1t" },
      draw: (g, w, h) => {
        g.font = K.font(F.sans, 34, 700); g.fillStyle = C.ink; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText("A Claude skill for personal writing", w / 2, h / 2 + 2);
      },
    });
    a.cta2 = K.sprite(700, 80, {
      seed: "cta2",
      tex: { base: C.red, seed: "cta2t" },
      draw: (g, w, h) => {
        g.font = K.font(F.type, 31, 700); g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText("Paste a draft. See what it flags.", w / 2, h / 2 + 2);
      },
    });
    K.buildPencil();
    return a;
  }

  // ------------------------------------------------------------------
  // Small animation helpers
  // ------------------------------------------------------------------
  const pop = (t, at, dur) => ease.outBack(prog(t, at, dur || 0.25));
  const inOut = (t, at, dur) => ease.inOutCubic(prog(t, at, dur));
  const out = (t, at, dur) => ease.outCubic(prog(t, at, dur));
  const cueOf = (id) => CUES.find((c) => c.id === id);
  const speaking = (t, id) => { const c = cueOf(id); return t >= c.at && t <= c.at + c.dur; };

  function star(ctx, x, y, s, color, rot) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot || 0); ctx.scale(s, s);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rad = i % 2 ? 7 : 22;
      ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function arrow(ctx, pts, color, progress, seed, boil) {
    const tip = sketch(ctx, pts, { color, width: 5, progress, seed, boil });
    if (progress >= 0.98 && pts.length > 1) {
      const a = pts[pts.length - 1], b = pts[pts.length - 3] || pts[0];
      const ang = Math.atan2(a[1] - b[1], a[0] - b[0]);
      const h1 = [[a[0] - Math.cos(ang - 0.5) * 26, a[1] - Math.sin(ang - 0.5) * 26], a, [a[0] - Math.cos(ang + 0.5) * 26, a[1] - Math.sin(ang + 0.5) * 26]];
      sketch(ctx, h1, { color, width: 5, seed: seed + "h", boil });
    }
    return tip;
  }

  // ------------------------------------------------------------------
  // The frame
  // ------------------------------------------------------------------
  function camera(t) {
    const keys = [[0, 1, 0, 0], [8.0, 1, 0, 0], [8.6, 0.955, 0, 18], [10.3, 0.955, 0, 18], [10.9, 1, 0, 0],
      [14.8, 1, 0, 0], [15.3, 0.985, 0, 6], [22.0, 0.985, 0, 6], [22.7, 1.035, -10, 10], [23.5, 1.035, -10, 10], [24.0, 1, 0, 0]];
    let k = 0;
    while (k < keys.length - 1 && t > keys[k + 1][0]) k++;
    const a = keys[k], b = keys[Math.min(k + 1, keys.length - 1)];
    const f = b[0] === a[0] ? 0 : ease.inOutCubic(clamp((t - a[0]) / (b[0] - a[0])));
    return { s: lerp(a[1], b[1], f), x: lerp(a[2], b[2], f), y: lerp(a[3], b[3], f) };
  }

  function renderFrame(ctx, tIn, opts) {
    opts = opts || {};
    if (!A) A = build();
    const frame = Math.floor(clamp(tIn, 0, DURATION) * FPS);
    const t = frame / FPS;
    const boil = Math.floor(t * 8);
    const fr = rng("frame" + frame);

    ctx.save();
    ctx.fillStyle = "#2B5F54";
    ctx.fillRect(0, 0, W, H);

    // camera: framing moves plus a touch of handheld wobble
    const cam = camera(t);
    let shakeX = (fr() - 0.5) * 2.2, shakeY = (fr() - 0.5) * 2.2;
    if (t >= T.stamp && t < T.stamp + 0.25) { const k = 1 - (t - T.stamp) / 0.25; shakeX += (fr() - 0.5) * 22 * k; shakeY += (fr() - 0.5) * 22 * k; }
    ctx.translate(W / 2 + cam.x + shakeX, H / 2 + cam.y + shakeY);
    ctx.scale(cam.s, cam.s);
    ctx.translate(-W / 2, -H / 2);

    ctx.drawImage(A.bg, -60, -60);

    if (t < 12.6) sceneEmail(ctx, t, boil);
    if (t >= 10.3 && t < 15.6) scenePyramid(ctx, t, boil);
    if (t >= 14.85 && t < 24.2) sceneNote(ctx, t, boil);
    if (t >= T.wipe) sceneTitle(ctx, t, boil);
    if (t >= 10.3 && t < T.taglineEnd + 4) pencilActor(ctx, t, boil);

    ctx.restore();

    // stop-motion exposure flicker, vignette and grain
    ctx.save();
    const flick = (fr() - 0.5) * 0.035;
    ctx.fillStyle = flick > 0 ? `rgba(255,250,240,${flick})` : `rgba(20,20,30,${-flick})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    K.vignette(ctx);
    if (!opts.noGrain) K.filmGrain(ctx, frame);
  }

  // Scene 1 and 2: the usual email, the clichés, and everyone sending it.
  function sceneEmail(ctx, t, boil) {
    const cx = 960, cy = 430;
    const leave = out(t, T.crumple + 0.05, 0.4);

    // label
    if (t >= 0.3 && t < T.crumple) place(ctx, A.lbl.fig, 250, 96, -0.03, pop(t, 0.3, 0.3));

    // photocopies, dealt in behind the card
    const fan = [[-70, 36, -0.15], [80, 26, 0.13], [-40, 60, -0.09], [56, 54, 0.08], [-96, 12, -0.21], [110, 10, 0.19], [-20, 80, -0.04], [30, 76, 0.04]];
    fan.forEach(([dx, dy, rot], i) => {
      const at = T.copies + i * 0.12;
      if (t < at) return;
      const p = out(t, at, 0.22);
      const offX = leave * -1700;
      place(ctx, A.copy, lerp(i % 2 ? 2300 : -400, cx + dx, p) + offX, lerp(cy + 500, cy + dy, p), lerp(rot * 3, rot, p), 0.96);
    });
    if (t >= 1.75 && t < T.crumple) {
      place(ctx, A.lbl.thousand, 1660, 800, -0.07, pop(t, 1.75, 0.3));
      arrow(ctx, K.linePoints(1640, 735, 1550, 665, "kx", 8), MAT_INK, prog(t, 2.0, 0.25), "kxa", boil);
    }

    if (t < T.cardIn) return;
    // the card itself, crumpling into a ball and thrown away
    let s = 1, rot = -0.02, x = cx, y = cy;
    const pin = out(t, T.cardIn, 0.38);
    y = lerp(1400, cy, pin);
    rot = lerp(0.14, -0.02, ease.outBack(prog(t, T.cardIn, 0.4)));
    if (t >= T.crumple) {
      const c = ease.inCubic(prog(t, T.crumple, 0.25));
      s = lerp(1, 0.18, c);
      rot += c * 1.4;
    }
    if (t >= T.crumple + 0.25) {
      // the ball, tossed off to the top left
      const p = prog(t, T.toss, 0.45);
      const bx = lerp(cx, -260, p), by = lerp(cy, cy - 120, p) - Math.sin(p * Math.PI) * 340;
      place(ctx, A.ball, bx, by, p * 7, 1);
    } else {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
      place(ctx, A.card, 0, 0);
      const ox = -A.card.w / 2, oy = -A.card.h / 2;
      A.words.forEach((wd) => {
        if (t < wd.at) return;
        const sc = wd.scale * (1 + (1 - pop(t, wd.at, 0.2)) * 0.6);
        place(ctx, wd.spr, ox + wd.lx, oy + wd.ly, wd.rot, sc);
      });
      // tape on the corners
      if (t > T.cardIn + 0.35) tape(ctx, ox + 40, oy + 10, 150, -0.5, "c1");
      if (t > T.cardIn + 0.45) tape(ctx, ox + A.card.w - 40, oy + 10, 150, 0.45, "c2");
      emailMarks(ctx, t, boil, ox, oy);
      ctx.restore();
    }

    // the chatbot sticker, talking
    if (t >= T.botIn && t < T.crumple + 0.4) {
      let bs = pop(t, T.botIn, 0.3), bx = 1590, by = 150, brot = 0.12;
      if (t >= T.crumple) { const p = ease.inCubic(prog(t, T.crumple, 0.4)); bx += p * 800; by -= p * 500; brot += p * 4; }
      const talking = (speaking(t, "b1") || speaking(t, "b2")) && rng("mouth" + Math.floor(t * 12))() > 0.35;
      place(ctx, talking ? A.botOpen : A.botShut, bx, by, brot, bs);
      if (t < T.crumple && (speaking(t, "b1") || speaking(t, "b2"))) {
        place(ctx, A.lbl.beep, 1780, 66, 0.08, pop(t, T.botIn + 0.25, 0.3));
      }
    }

    // a chain of identical paper dolls, all holding the same email
    if (t >= T.dolls) {
      const p = out(t, T.dolls, 0.55);
      const hop = Math.abs(Math.sin(t * 9)) * 8 * (t < T.crumple ? 1 : 0);
      const lx = lerp(-700, 960, p) + leave * 2000;
      place(ctx, A.dolls, lx, 948 - hop, 0, 1);
    }
  }

  // Red marker circles, labels and the blue pencil's strike-throughs on the card.
  function emailMarks(ctx, t, boil, ox, oy) {
    const ws = A.words;
    const box = (list) => {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      list.forEach((w) => {
        const hw = (w.spr.w * w.scale) / 2, hh = (w.spr.h * w.scale) / 2;
        x0 = Math.min(x0, w.lx - hw); x1 = Math.max(x1, w.lx + hw);
        y0 = Math.min(y0, w.ly - hh); y1 = Math.max(y1, w.ly + hh);
      });
      return { cx: ox + (x0 + x1) / 2, cy: oy + (y0 + y1) / 2, rx: (x1 - x0) / 2 + 30, ry: (y1 - y0) / 2 + 24 };
    };
    const opener = box(ws.filter((w) => w.group === 0));
    const vibrant = box(ws.filter((w) => w.text === "vibrant"));
    const testament = box(ws.filter((w) => w.text === "testament."));
    const red = C.redInk;
    if (t >= T.circles) {
      sketch(ctx, K.loopPoints(opener.cx, opener.cy, opener.rx, opener.ry, "op"), { color: red, width: 7, progress: prog(t, T.circles, 0.5), seed: "op", boil });
      sketch(ctx, K.loopPoints(vibrant.cx, vibrant.cy, vibrant.rx, vibrant.ry, "vi"), { color: red, width: 7, progress: prog(t, T.circles + 0.55, 0.3), seed: "vi", boil });
      sketch(ctx, K.loopPoints(testament.cx, testament.cy, testament.rx, testament.ry, "te"), { color: red, width: 7, progress: prog(t, T.circles + 0.85, 0.3), seed: "te", boil });
      if (t >= T.circles + 0.35) {
        place(ctx, A.lbl.opener, ox - 175, oy + 120, -0.07, pop(t, T.circles + 0.35, 0.25));
        arrow(ctx, K.linePoints(ox - 60, oy + 165, opener.cx - opener.rx + 4, opener.cy, "a1", 10), MAT_INK, prog(t, T.circles + 0.5, 0.2), "a1", boil);
      }
      if (t >= T.circles + 0.75) {
        place(ctx, A.lbl.brochure, ox + A.card.w + 185, oy + 300, 0.06, pop(t, T.circles + 0.75, 0.25));
        arrow(ctx, K.linePoints(ox + A.card.w + 40, oy + 340, vibrant.cx + vibrant.rx + 6, vibrant.cy + 8, "a2", 10), MAT_INK, prog(t, T.circles + 0.85, 0.2), "a2", boil);
      }
      if (t >= T.circles + 1.05) {
        place(ctx, A.lbl.puffery, ox + 120, oy + A.card.h + 78, -0.04, pop(t, T.circles + 1.05, 0.25));
        arrow(ctx, K.linePoints(ox + 210, oy + A.card.h + 50, testament.cx - 20, testament.cy + testament.ry, "a3", 8), MAT_INK, prog(t, T.circles + 1.15, 0.2), "a3", boil);
      }
    }
    // strike-throughs, one per line of clippings
    if (t >= T.strike) {
      const rows = {};
      ws.forEach((w) => { const k = Math.round(w.ly); (rows[k] = rows[k] || []).push(w); });
      Object.values(rows).sort((a, b) => a[0].ly - b[0].ly).forEach((row, i) => {
        const b = box(row);
        sketch(ctx, K.linePoints(b.cx - b.rx + 30, b.cy + 4, b.cx + b.rx - 30, b.cy - 6, "st" + i, 4),
          { color: C.pencil, width: 9, progress: prog(t, T.strike + i * 0.2, 0.18), seed: "st" + i, boil, jitter: 1.5 });
      });
    }
  }

  // Scene 3: the point first, then the details under it.
  function scenePyramid(ctx, t, boil) {
    const leave = ease.inCubic(prog(t, 14.85, 0.35));
    const dy = -leave * 1000;
    if (t >= T.point) {
      const p = prog(t, T.point, 0.28);
      const y = p < 1 ? lerp(-200, 330, ease.inCubic(p)) : 330 - Math.sin(prog(t, T.point + 0.28, 0.2) * Math.PI) * 14;
      place(ctx, A.point, 960, y + dy, -0.01, 1);
      if (t >= T.point + 0.3) {
        place(ctx, A.lbl.point, 300, 236 + dy, -0.05, pop(t, T.point + 0.3, 0.25));
        arrow(ctx, K.linePoints(440, 262 + dy, 535, 312 + dy, "pa", 10), MAT_INK, prog(t, T.point + 0.45, 0.2), "pa", boil);
      }
    }
    if (t >= T.details) place(ctx, A.detailA, lerp(-400, 650, out(t, T.details, 0.25)), 590 + dy, -0.02, 1);
    if (t >= T.details + 0.25) place(ctx, A.detailB, lerp(2300, 1270, out(t, T.details + 0.25, 0.25)), 590 + dy, 0.02, 1);
    if (t >= T.connect) {
      sketch(ctx, K.linePoints(900, 405 + dy, 700, 522 + dy, "c1", 6), { color: MAT_INK, width: 6, progress: prog(t, T.connect, 0.18), seed: "c1", boil });
      sketch(ctx, K.linePoints(1020, 405 + dy, 1220, 522 + dy, "c2", 6), { color: MAT_INK, width: 6, progress: prog(t, T.connect + 0.18, 0.18), seed: "c2", boil });
    }
    if (t >= 14.05) {
      sketch(ctx, [[360, 680 + dy], [360, 700 + dy], [1560, 700 + dy], [1560, 680 + dy]], { color: MAT_INK, width: 6, progress: prog(t, 14.05, 0.25), seed: "br", boil });
      if (t >= 14.15) place(ctx, A.lbl.details, 960, 776 + dy, 0.03, pop(t, 14.15, 0.25));
    }
    if (t >= T.polaroid && t < 14.9) {
      place(ctx, A.polaroid, 1690, 640, 0.1, pop(t, T.polaroid, 0.3));
      if (t > T.polaroid + 0.2) tape(ctx, 1690, 505, 130, 0.08, "pt");
    }
  }

  // Scene 4 and 5: the rewritten note, the methods, the check and the stamp.
  function sceneNote(ctx, t, boil) {
    const nx = 960, ny = 520;
    const titleCover = t >= T.wipe + 0.55;
    if (titleCover) return;
    const nIn = out(t, T.noteIn, 0.35);
    const noteY = lerp(1500, ny, nIn);
    place(ctx, A.note, nx, noteY, 0.008, 1);
    const ox = nx - A.note.w / 2, oy = noteY - A.note.h / 2;
    tape(ctx, ox + 60, oy + 14, 160, -0.45, "n1");
    tape(ctx, ox + A.note.w - 60, oy + 14, 160, 0.4, "n2");

    // the polaroid moves over from the pyramid and gets taped on
    {
      const p = inOut(t, 14.9, 0.5);
      const px = lerp(1690, ox + A.note.w + 22, p), py = lerp(640, oy + 66, p);
      place(ctx, A.polaroid, px, py, lerp(0.1, 0.13, p), lerp(1, 0.78, p));
      if (t > 15.4) tape(ctx, px - 10, py - 108, 120, 0.15, "pn");
    }

    // check marks after each line is read
    T.sweeps.forEach(([a, b], i) => {
      if (t < b) return;
      const ly = oy + [NOTE_LINES[0].y, NOTE_LINES[1].y, NOTE_LINES[2].y, NOTE_LINES[3].y][i] - 12;
      const lx = i === 0 ? ox + 350 : ox + A.note.w - 72;
      sketch(ctx, [[lx - 18, ly], [lx - 4, ly + 16], [lx + 24, ly - 20]], { color: C.pencil, width: 7, progress: prog(t, b, 0.12), seed: "ck" + i, boil });
    });

    // the tag and the stamp
    if (t >= T.lens + 0.2) place(ctx, A.tellTag, ox + 560, oy - 4, 0.04, pop(t, T.lens + 0.2, 0.3));
    if (t >= T.stamp) place(ctx, A.stamp, ox + A.note.w - 300, oy + A.note.h - 110, -0.12, 0.82, 0.95);
    if (t >= T.stamp - 0.3 && t < T.stamp + 0.5) {
      let sy;
      if (t < T.stamp) sy = lerp(-320, oy + A.note.h - 110, ease.inCubic(prog(t, T.stamp - 0.3, 0.3)));
      else sy = lerp(oy + A.note.h - 110, -360, ease.inCubic(prog(t, T.stamp + 0.12, 0.38)));
      const squash = t >= T.stamp && t < T.stamp + 0.12 ? 0.94 : 1;
      ctx.save(); ctx.translate(ox + A.note.w - 300, sy); ctx.rotate(-0.12); ctx.scale(0.82, 0.82 * squash);
      K.stampTool(ctx, 0, 0, 1); ctx.restore();
    }

    // method cards land on the beat, then clear away
    METHODS.forEach((m, i) => {
      const at = T.methods[i];
      if (t < at) return;
      const [mx, my, mr, side] = METHOD_SPOTS[i];
      const p = out(t, at, 0.24);
      const offAway = ease.inCubic(prog(t, 22.05 + i * 0.04, 0.3));
      const x = lerp(side < 0 ? -320 : 2240, mx, p) + side * offAway * 700;
      const s = 1 + (1 - pop(t, at, 0.26)) * 0.25;
      place(ctx, A.methods[i], x, my, mr + (1 - p) * side * 0.4, s);
      if (t > at + 0.18) tape(ctx, x, my - 100, 110, mr * 2, "mt" + i);
    });

    // the magnifier reads the note line by line
    if (t >= T.lens && t < 21.5) {
      const lineY = [NOTE_LINES[0].y, NOTE_LINES[1].y, NOTE_LINES[2].y, NOTE_LINES[3].y].map((y) => oy + y - 14);
      let lx, ly;
      if (t < T.sweeps[0][0]) { const p = inOut(t, T.lens, 0.3); lx = lerp(1800, ox + 150, p); ly = lerp(1050, lineY[0], p); }
      else if (t >= T.sweeps[3][1]) { const p = ease.inCubic(prog(t, T.sweeps[3][1], 0.3)); lx = lerp(ox + A.note.w - 120, 2200, p); ly = lerp(lineY[3], 1250, p); }
      else {
        let i = T.sweeps.findIndex(([a, b]) => t < b);
        if (i < 0) i = 3;
        const [a, b] = T.sweeps[i];
        const endX = i === 0 ? ox + 340 : ox + A.note.w - 120;
        const p = inOut(t, a, b - a);
        lx = lerp(ox + 150, endX, p); ly = lineY[i];
      }
      K.magnifier(ctx, lx, ly, 112, (g) => {
        g.save();
        g.scale(1.55, 1.55);
        g.translate(-lx, -ly);
        g.drawImage(A.bg, -60, -60);
        place(g, A.note, nx, noteY, 0.008, 1);
        g.restore();
      });
    }

    // "you": a paper doll with a face, proud of the note
    if (t >= T.you) {
      const p = pop(t, T.you, 0.35);
      const wave = Math.sin(t * 10) * 0.06 * (t > T.you + 0.35 ? 1 : 0);
      place(ctx, A.you, 330, lerp(1300, 760, p), wave, 1);
      if (t >= T.you + 0.35) {
        place(ctx, A.lbl.you, 170, 430, -0.1, pop(t, T.you + 0.35, 0.25));
        arrow(ctx, K.linePoints(190, 480, 285, 548, "ya", 8), MAT_INK, prog(t, T.you + 0.45, 0.2), "ya", boil);
      }
      [[560, 210, 0.9, C.mustard], [1480, 230, 0.7, C.pencil], [250, 420, 0.6, C.red], [1700, 820, 0.8, C.mustard], [700, 880, 0.55, C.pencil]].forEach(([sx, sy, sc, col], i) => {
        const tw = pop(t, T.you + 0.25 + i * 0.12, 0.25);
        const pulse = 0.85 + 0.15 * Math.sin(t * 8 + i);
        if (tw > 0) star(ctx, sx, sy, sc * tw * pulse, col, i * 0.4);
      });
    }
  }

  // The blue pencil: enters, strikes the clichés, draws the pyramid, writes the tagline.
  function pencilActor(ctx, t, boil) {
    let x, y, ang = -0.75, look = Math.PI, show = true, blink = 0;
    const rowsY = [146, 252, 358, 456];
    const cardO = { x: 960 - A.card.w / 2, y: 430 - A.card.h / 2 };
    if (t < T.strike) {
      const p = ease.outBack(prog(t, T.pencilIn, 0.45));
      x = lerp(2300, cardO.x + A.card.w - 60, p); y = lerp(-200, cardO.y + rowsY[0], p);
      look = Math.PI * 0.9;
    } else if (t < T.crumple) {
      const i = Math.min(3, Math.floor((t - T.strike) / 0.2));
      const f = clamp((t - T.strike - i * 0.2) / 0.18);
      x = lerp(cardO.x + 130, cardO.x + A.card.w - 80, f); y = cardO.y + rowsY[i] + 4;
      look = 0;
    } else if (t < T.point + 0.3) {
      const p = inOut(t, T.crumple, 0.6);
      x = lerp(cardO.x + A.card.w - 80, 1560, p); y = lerp(cardO.y + rowsY[3], 260, p); look = Math.PI * 0.8;
    } else if (t < T.connect) {
      x = 1560 + Math.sin(t * 6) * 6; y = 260; look = Math.PI * 0.9;
      blink = t > 13.0 && t < 13.12 ? 1 : 0;
    } else if (t < T.connect + 0.4) {
      const first = t < T.connect + 0.18;
      const f = prog(t, first ? T.connect : T.connect + 0.18, 0.18);
      x = first ? lerp(900, 700, f) : lerp(1020, 1220, f); y = lerp(405, 522, f);
      look = Math.PI * 0.6;
    } else if (t < 15.2) {
      const p = inOut(t, T.connect + 0.4, 0.5);
      x = lerp(1220, 1750, p); y = lerp(522, 150, p);
      if (t > 14.85) { const q = ease.inCubic(prog(t, 14.85, 0.35)); y -= q * 600; }
    } else if (t < T.wipe + 0.4) {
      show = false;
    } else if (t < T.tagline) {
      const p = out(t, T.wipe + 0.4, 0.5);
      x = lerp(2300, 1640, p); y = lerp(900, 640, p); look = Math.PI;
    } else if (t < T.taglineEnd) {
      const g = tagGeom(ctx);
      const f = prog(t, T.tagline, T.taglineEnd - T.tagline);
      x = g.left + g.width * f; y = g.y - 18 + Math.sin(t * 40) * 6;
      look = 0;
    } else {
      const g = tagGeom(ctx);
      const p = inOut(t, T.taglineEnd, 0.5);
      x = lerp(g.left + g.width, 1610, p); y = lerp(g.y - 18, 900, p); ang = lerp(-0.75, -0.95, p);
      blink = t > 28.1 && t < 28.3 ? 1 : 0;
    }
    if (show) K.pencil(ctx, x, y, ang, 1, { look, blink, smile: t > T.tagline });
  }

  let tagCache = null;
  function tagGeom(ctx) {
    if (tagCache) return tagCache;
    ctx.save();
    ctx.font = K.font(F.hand, 112, 700);
    const w = ctx.measureText("Lead with the point.").width;
    ctx.restore();
    tagCache = { left: W / 2 - w / 2, width: w, y: 690 };
    return tagCache;
  }

  // Scene 6: the legal pad wipes in, the title builds itself, the pencil writes the line.
  function sceneTitle(ctx, t, boil) {
    const p = ease.inOutCubic(prog(t, T.wipe, 0.55));
    const x = lerp(W + 140, W / 2 - 40, p);
    place(ctx, A.legal, x, H / 2, 0, 1);
    if (p < 1) return;
    A.letters.forEach((l) => {
      if (t < l.at) return;
      const s = pop(t, l.at, 0.22);
      place(ctx, l.spr, l.x, l.y, l.rot + (1 - s) * 0.6, 0.96 * s);
    });
    if (t >= T.tagline) {
      const g = tagGeom(ctx);
      K.handText(ctx, "Lead with the point.", g.left, g.y, { size: 112, weight: 700, color: C.pencil, progress: prog(t, T.tagline, T.taglineEnd - T.tagline), boil });
      if (t > T.taglineEnd) sketch(ctx, K.linePoints(g.left + 20, g.y + 26, g.left + g.width - 10, g.y + 18, "ul", 8), { color: C.red, width: 7, progress: prog(t, T.taglineEnd, 0.3), seed: "ul", boil });
    }
    if (t >= T.cta) {
      place(ctx, A.cta1, 960, 838, -0.015, pop(t, T.cta, 0.3));
      if (t >= T.cta + 0.25) place(ctx, A.cta2, 960, 944, 0.02, pop(t, T.cta + 0.25, 0.3));
      if (t >= T.cta + 0.35) tape(ctx, 960 - 300, 812, 110, -0.3, "ct1");
    }
    if (t >= 27.2) {
      [[300, 250, 0.8, C.red], [1620, 250, 0.7, C.pencil], [330, 820, 0.6, C.pencil], [1580, 760, 0.65, C.red]].forEach(([sx, sy, sc, col], i) => {
        const pulse = 0.8 + 0.2 * Math.sin(t * 6 + i * 1.7);
        star(ctx, sx, sy, sc * pop(t, 27.2 + i * 0.15, 0.3) * pulse, col, i);
      });
    }
  }

  function reset() { A = null; tagCache = null; }

  const WORD_TIMES = BOT_WORDS.flatMap((g) => wordTimes(g));

  root.WordsmithFilmScenes = { FPS, DURATION, CUES, T, METHODS, NOTE_LINES, WORD_TIMES, renderFrame, reset, build: () => (A = build()) };
})(typeof window !== "undefined" ? window : this);
