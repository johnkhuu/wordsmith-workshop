/*
 * Wordsmith Workshop film: the art kit.
 *
 * Everything here draws deterministically: the same inputs give the same
 * pixels, so any moment of the film can be redrawn from its timestamp alone.
 * That's what keeps the picture in sync with the audio, lets the player
 * seek, and lets the export render frame by frame.
 *
 * Paper pieces are pre-rendered once into "sprites" (texture, torn edge,
 * shadow and content baked in) and then placed, rotated and scaled per frame.
 */
(function (root) {
  "use strict";

  const W = 1920;
  const H = 1080;

  // ------------------------------------------------------------------
  // Random numbers that repeat: the same seed always gives the same run.
  // ------------------------------------------------------------------
  function hash(s) {
    s = String(s);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function rng(seed) {
    let a = (typeof seed === "number" ? seed : hash(seed)) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ------------------------------------------------------------------
  // Timing helpers
  // ------------------------------------------------------------------
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const prog = (t, start, dur) => clamp((t - start) / dur);
  const ease = {
    linear: (x) => x,
    outCubic: (x) => 1 - Math.pow(1 - x, 3),
    inCubic: (x) => x * x * x,
    inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    outBack: (x) => {
      const s = 1.9;
      return 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
    },
    inBack: (x) => {
      const s = 1.7;
      return (s + 1) * x * x * x - s * x * x;
    },
    outElastic: (x) => (x === 0 || x === 1 ? x
      : Math.pow(2, -9 * x) * Math.sin((x * 9 - 0.75) * (2 * Math.PI) / 3) + 1),
  };

  // ------------------------------------------------------------------
  // Colours and type
  // ------------------------------------------------------------------
  const C = {
    ink: "#1F2433",
    inkSoft: "#4C5366",
    pencil: "#2450C0",
    pencilDark: "#183A92",
    pencilLight: "#4F7BE6",
    red: "#D13B2F",
    redInk: "#C8352A",
    graph: "#EEF2F6",
    graphLine: "#CBD8E8",
    graphLineBold: "#B3C6DE",
    white: "#FBFAF6",
    card: "#FFFDF8",
    rule: "#AFC7EA",
    margin: "#E58C8C",
    news: "#E3DFD6",
    kraft: "#C7A274",
    kraftDark: "#A9845A",
    yellow: "#F6E39A",
    legal: "#F8E9A1",
    mustard: "#E8B93C",
    blush: "#F2A7A0",
    sky: "#DCE7FA",
    tape: "rgba(236, 226, 196, 0.78)",
  };

  const F = {
    display: "Gloock, 'Iowan Old Style', Georgia, serif",
    type: "'Courier Prime', 'Courier New', monospace",
    hand: "Caveat, 'Segoe Print', 'Bradley Hand', cursive",
    sans: "'Atkinson Hyperlegible', 'Segoe UI', system-ui, sans-serif",
  };

  function font(family, size, weight) {
    return `${weight || 400} ${size}px ${family}`;
  }

  // ------------------------------------------------------------------
  // Canvases
  // ------------------------------------------------------------------
  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  // A small tile of grain, reused as a pattern so textures stay cheap to build.
  let grainTile = null;
  function grain() {
    if (grainTile) return grainTile;
    const c = makeCanvas(256, 256);
    const g = c.getContext("2d");
    const img = g.createImageData(256, 256);
    const r = rng("grain");
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(r() * 255);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grainTile = c;
    return c;
  }

  // Paper texture: base colour, soft mottling, fibres, grain, and optional
  // ruled lines, a margin line, a grid or faint newsprint.
  function paperTexture(w, h, o) {
    const c = makeCanvas(w, h);
    const g = c.getContext("2d");
    const r = rng(o.seed || "paper");
    g.fillStyle = o.base;
    g.fillRect(0, 0, w, h);

    for (let i = 0; i < 7; i++) {
      const x = r() * w, y = r() * h, rad = (0.25 + r() * 0.6) * Math.max(w, h);
      const light = r() > 0.5;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, light ? "rgba(255,255,255,0.10)" : "rgba(90,70,40,0.045)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }

    if (o.grid) {
      const gap = o.grid;
      g.lineWidth = 1;
      for (let x = (o.gridOffset || 0); x < w; x += gap) {
        g.strokeStyle = Math.round(x / gap) % 5 === 0 ? C.graphLineBold : C.graphLine;
        g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); g.stroke();
      }
      for (let y = (o.gridOffset || 0); y < h; y += gap) {
        g.strokeStyle = Math.round(y / gap) % 5 === 0 ? C.graphLineBold : C.graphLine;
        g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke();
      }
    }
    if (o.rules) {
      g.strokeStyle = o.ruleColor || C.rule;
      g.lineWidth = 2;
      for (let y = o.rulesTop || o.rules; y < h; y += o.rules) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      }
    }
    if (o.marginX) {
      g.strokeStyle = o.marginColor || C.margin;
      g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(o.marginX, 0); g.lineTo(o.marginX, h); g.stroke();
      if (o.doubleMargin) { g.beginPath(); g.moveTo(o.marginX + 6, 0); g.lineTo(o.marginX + 6, h); g.stroke(); }
    }
    if (o.newsprint) {
      g.fillStyle = "rgba(60,60,60,0.10)";
      for (let y = 8; y < h; y += 9) {
        let x = 6;
        while (x < w - 6) {
          const wl = 6 + r() * 26;
          g.fillRect(x, y, Math.min(wl, w - 6 - x), 3);
          x += wl + 4;
        }
      }
    }
    if (o.dots) {
      g.fillStyle = o.dots;
      for (let y = 10; y < h; y += 22) for (let x = (y / 22) % 2 ? 10 : 21; x < w; x += 22) {
        g.beginPath(); g.arc(x, y, 3.2, 0, Math.PI * 2); g.fill();
      }
    }

    // fibres
    const fibers = o.fibers == null ? Math.round((w * h) / 9000) : o.fibers;
    for (let i = 0; i < fibers; i++) {
      const x = r() * w, y = r() * h, len = 6 + r() * 26, a = r() * Math.PI;
      g.strokeStyle = r() > 0.5 ? "rgba(255,255,255,0.35)" : "rgba(80,60,40,0.07)";
      g.lineWidth = 0.6 + r() * 0.7;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (r() - 0.5) * 6, y + Math.sin(a) * len * 0.5 + (r() - 0.5) * 6,
        x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }

    // grain
    g.save();
    g.globalAlpha = o.grain == null ? 0.07 : o.grain;
    g.globalCompositeOperation = "overlay";
    g.fillStyle = g.createPattern(grain(), "repeat");
    g.translate(r() * 256, r() * 256);
    g.fillRect(-256, -256, w + 512, h + 512);
    g.restore();
    return c;
  }

  // A green self-healing cutting mat: the desk the whole collage is made on.
  function matTexture(w, h) {
    const c = makeCanvas(w, h);
    const g = c.getContext("2d");
    const r = rng("mat");
    const base = g.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#2F6A5E");
    base.addColorStop(1, "#285A50");
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      const x = r() * w, y = r() * h, rad = (0.2 + r() * 0.5) * w;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, r() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,20,15,0.08)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
    const gap = 40, off = 20;
    g.lineWidth = 1;
    for (let x = off, i = 0; x < w; x += gap, i++) {
      g.strokeStyle = i % 5 === 0 ? "rgba(235,245,238,0.24)" : "rgba(235,245,238,0.09)";
      g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); g.stroke();
    }
    for (let y = off, i = 0; y < h; y += gap, i++) {
      g.strokeStyle = i % 5 === 0 ? "rgba(235,245,238,0.24)" : "rgba(235,245,238,0.09)";
      g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke();
    }
    // 45 and 60 degree guides
    g.strokeStyle = "rgba(235,245,238,0.07)"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, h); g.lineTo(h, 0); g.moveTo(w - h * 1.2, h); g.lineTo(w, h - h * 0.69 * 1.2); g.stroke();
    // ruler numbers along the edges
    g.fillStyle = "rgba(235,245,238,0.42)";
    g.font = font(F.sans, 17, 700);
    g.textAlign = "center";
    for (let x = off + gap * 5, n = 5; x < w - 30; x += gap * 5, n += 5) g.fillText(String(n / 5), x, 34);
    g.textAlign = "left";
    for (let y = off + gap * 5, n = 5; y < h - 20; y += gap * 5, n += 5) g.fillText(String(n / 5), 8, y + 6);
    // grain
    g.save();
    g.globalAlpha = 0.09;
    g.globalCompositeOperation = "overlay";
    g.fillStyle = g.createPattern(grain(), "repeat");
    g.fillRect(0, 0, w, h);
    g.restore();
    return c;
  }

  // ------------------------------------------------------------------
  // Edges: a rectangle outline with torn (ragged) or cut (nearly straight) sides.
  // ------------------------------------------------------------------
  function edgePoints(w, h, seed, torn, rough) {
    const r = rng(seed);
    const pts = [];
    const sides = [
      [0, 0, w, 0, torn.top], [w, 0, w, h, torn.right],
      [w, h, 0, h, torn.bottom], [0, h, 0, 0, torn.left],
    ];
    for (const [x0, y0, x1, y1, isTorn] of sides) {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const step = isTorn ? 6 : 36;
      const n = Math.max(2, Math.round(len / step));
      const nx = (y1 - y0) / len, ny = -(x1 - x0) / len;
      let wob = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        let d;
        if (isTorn) {
          wob = wob * 0.82 + (r() - 0.5) * 3.2;
          d = (wob + (r() - 0.5) * 3.4) * rough - 2 * rough;
        } else {
          d = (r() - 0.5) * 1.4;
        }
        pts.push([x0 + (x1 - x0) * t + nx * d, y0 + (y1 - y0) * t + ny * d]);
      }
    }
    return pts;
  }

  function pathFrom(pts, ox, oy) {
    const p = new Path2D();
    pts.forEach(([x, y], i) => (i ? p.lineTo(x + ox, y + oy) : p.moveTo(x + ox, y + oy)));
    p.closePath();
    return p;
  }

  // ------------------------------------------------------------------
  // Sprites: a paper piece with texture, edge, shadow and content baked in.
  // o: { seed, texture (canvas) | tex (paperTexture options), torn, rough,
  //      shadow, rim, draw(g, w, h), shape (custom Path2D builder) }
  // ------------------------------------------------------------------
  function sprite(w, h, o) {
    const pad = o.shadow === false ? 6 : 34;
    const c = makeCanvas(w + pad * 2, h + pad * 2);
    const g = c.getContext("2d");
    const torn = o.torn || {};
    const anyTorn = torn.top || torn.right || torn.bottom || torn.left;
    const path = o.shape ? o.shape(pad) : pathFrom(edgePoints(w, h, o.seed || "s", torn, o.rough || 1), pad, pad);

    if (o.shadow !== false) {
      g.save();
      g.shadowColor = o.shadowColor || "rgba(28, 30, 45, 0.30)";
      g.shadowBlur = o.shadowBlur || 18;
      g.shadowOffsetX = 5;
      g.shadowOffsetY = 10;
      g.fillStyle = o.rim || "#F4F1EA";
      g.fill(path);
      g.restore();
    }
    if (anyTorn) {
      g.save();
      g.lineWidth = 6;
      g.lineJoin = "round";
      g.strokeStyle = o.rim || "#F7F4EC";
      g.stroke(path);
      g.restore();
    }
    g.save();
    g.clip(path);
    g.translate(pad, pad);
    const tex = o.texture || paperTexture(w, h, Object.assign({ base: C.white, seed: o.seed }, o.tex || {}));
    g.drawImage(tex, 0, 0, w, h);
    if (o.draw) o.draw(g, w, h);
    g.restore();
    return { canvas: c, w, h, pad };
  }

  // Place a sprite centred at (x, y).
  function place(ctx, spr, x, y, rot, scale, alpha) {
    if (!spr) return;
    ctx.save();
    if (alpha != null) ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    if (scale != null && scale !== 1) ctx.scale(scale, scale);
    ctx.drawImage(spr.canvas, -spr.w / 2 - spr.pad, -spr.h / 2 - spr.pad);
    ctx.restore();
  }

  // Masking tape strip, centred at (x, y).
  function tape(ctx, x, y, w, rot, seed) {
    const r = rng("tape" + seed);
    const h = 44;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    const zig = (x0, dir) => {
      for (let i = 0; i <= 6; i++) ctx.lineTo(x0 + dir * (i % 2 ? 5 : 0) + (r() - 0.5) * 2, -h / 2 + (h * i) / 6);
    };
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2, -h / 2);
    zig(w / 2, 1);
    ctx.lineTo(-w / 2, h / 2);
    for (let i = 6; i >= 0; i--) ctx.lineTo(-w / 2 - (i % 2 ? 5 : 0) + (r() - 0.5) * 2, -h / 2 + (h * i) / 6);
    ctx.closePath();
    ctx.shadowColor = "rgba(30,30,40,0.12)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = C.tape;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const yy = -h / 2 + 8 + r() * (h - 16);
      ctx.beginPath(); ctx.moveTo(-w / 2 + 6, yy); ctx.lineTo(w / 2 - 6, yy + (r() - 0.5) * 3); ctx.stroke();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------
  // Hand-drawn strokes. They "boil" (wobble a little) from pose to pose, like
  // lines redrawn by hand on every frame of a stop-motion film.
  // ------------------------------------------------------------------
  function smooth(ctx, pts) {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const l = pts[pts.length - 1];
    ctx.lineTo(l[0], l[1]);
  }

  function partial(pts, p) {
    if (p >= 1) return pts;
    if (p <= 0 || pts.length < 2) return [];
    const L = [0];
    for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const target = p * L[L.length - 1];
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (L[i] >= target) {
        const f = (target - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]);
        out.push([lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)]);
        return out;
      }
      out.push(pts[i]);
    }
    return out;
  }

  function jitter(pts, seed, amt) {
    const r = rng(seed);
    return pts.map(([x, y]) => [x + (r() - 0.5) * amt, y + (r() - 0.5) * amt]);
  }

  // Draws pts up to `progress` and returns the pen tip, so a pencil can follow it.
  function sketch(ctx, pts, o) {
    const p = partial(pts, o.progress == null ? 1 : o.progress);
    if (p.length < 2) return p[0] || null;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = o.color || C.ink;
    const passes = o.passes || 2;
    for (let k = 0; k < passes; k++) {
      const q = jitter(p, hash(o.seed + ":" + k + ":" + (o.boil || 0)), o.jitter == null ? 2.4 : o.jitter);
      ctx.globalAlpha = (o.alpha == null ? 0.92 : o.alpha) * (k === 0 ? 1 : 0.5);
      ctx.lineWidth = k === 0 ? o.width || 5 : (o.width || 5) * 0.55;
      ctx.beginPath();
      smooth(ctx, q);
      ctx.stroke();
    }
    ctx.restore();
    return p[p.length - 1];
  }

  // A marker circle: a little over one turn, slightly uneven, like a quick loop by hand.
  function loopPoints(cx, cy, rx, ry, seed, turns) {
    const r = rng("loop" + seed);
    const a0 = -2.4 + (r() - 0.5) * 0.5;
    const n = 72;
    const pts = [];
    const ph = r() * 6;
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const a = a0 + f * (turns || 1.13) * Math.PI * 2;
      const grow = 1 + f * 0.07;
      const wob = 1 + 0.035 * Math.sin(f * 9 + ph);
      pts.push([cx + Math.cos(a) * rx * grow * wob, cy + Math.sin(a) * ry * grow * wob]);
    }
    return pts;
  }

  function linePoints(x0, y0, x1, y1, seed, bow) {
    const r = rng("line" + seed);
    const pts = [];
    const n = 16;
    const b = (bow == null ? 6 : bow) * (r() > 0.5 ? 1 : -1);
    const nx = -(y1 - y0), ny = x1 - x0, len = Math.hypot(nx, ny) || 1;
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const s = Math.sin(f * Math.PI) * b;
      pts.push([lerp(x0, x1, f) + (nx / len) * s, lerp(y0, y1, f) + (ny / len) * s]);
    }
    return pts;
  }

  // Handwriting that appears left to right; returns the x of the writing edge.
  function handText(ctx, text, x, y, o) {
    ctx.save();
    ctx.font = font(o.family || F.hand, o.size || 48, o.weight || 600);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    const w = ctx.measureText(text).width;
    const left = o.align === "center" ? x - w / 2 : x;
    const reveal = o.progress == null ? 1 : o.progress;
    ctx.beginPath();
    ctx.rect(left - 20, y - (o.size || 48) * 1.3, (w + 40) * reveal, (o.size || 48) * 1.9);
    ctx.clip();
    ctx.translate(left, y);
    if (o.rot) ctx.rotate(o.rot);
    const r = rng("ht" + text + (o.boil || 0));
    ctx.fillStyle = o.color || C.ink;
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    ctx.translate((r() - 0.5) * 1.6, (r() - 0.5) * 1.6);
    ctx.fillText(text, 0, 0);
    ctx.restore();
    return left + w * reveal;
  }

  // ------------------------------------------------------------------
  // Characters and props
  // ------------------------------------------------------------------

  // The blue pencil. Drawn in its own frame: tip at the origin, body along +x.
  let pencilSprite = null;
  function buildPencil() {
    const L = 380, R = 26, pad = 40;
    const c = makeCanvas(L + pad * 2, R * 2 + pad * 2);
    const g = c.getContext("2d");
    g.translate(pad, pad + R);
    const body = new Path2D();
    body.moveTo(0, 0); body.lineTo(34, -8); body.lineTo(84, -R); body.lineTo(318, -R);
    body.lineTo(318, R); body.lineTo(84, R); body.lineTo(34, 8); body.closePath();
    g.save();
    g.shadowColor = "rgba(20, 25, 50, 0.32)"; g.shadowBlur = 16; g.shadowOffsetX = 6; g.shadowOffsetY = 12;
    g.fillStyle = "#000"; g.fill(body);
    g.fillRect(318, -R, 66, R * 2);
    g.restore();
    // wood
    const wood = new Path2D();
    wood.moveTo(30, -7.5); wood.lineTo(84, -R);
    for (let i = 0; i <= 6; i++) wood.lineTo(84 + (i % 2 ? 9 : 0), -R + (R * 2 * i) / 6);
    wood.lineTo(84, R); wood.lineTo(30, 7.5); wood.closePath();
    g.fillStyle = "#EBCB9E"; g.fill(wood);
    g.fillStyle = "rgba(160,110,60,0.35)";
    g.beginPath(); g.moveTo(34, 2); g.lineTo(84, 10); g.lineTo(84, R); g.lineTo(34, 8); g.fill();
    // graphite (blue lead)
    g.fillStyle = C.pencilDark;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(31, -8); g.lineTo(31, 8); g.closePath(); g.fill();
    // body facets
    const facet = (y0, y1, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(88, y0); for (let i = 0; i <= 6; i++) g.lineTo(84 + (i % 2 ? 9 : 0), y0 + ((y1 - y0) * i) / 6); g.lineTo(318, y1); g.lineTo(318, y0); g.closePath(); g.fill(); };
    facet(-R, -R / 3, C.pencilLight);
    facet(-R / 3, R / 3, C.pencil);
    facet(R / 3, R, C.pencilDark);
    g.fillStyle = "rgba(255,255,255,0.18)"; g.fillRect(96, -R + 4, 214, 4);
    // ferrule
    const fer = g.createLinearGradient(0, -R, 0, R);
    fer.addColorStop(0, "#EEF0F4"); fer.addColorStop(0.45, "#B9BEC9"); fer.addColorStop(1, "#7E8594");
    g.fillStyle = fer; g.fillRect(318, -R - 1, 36, R * 2 + 2);
    g.strokeStyle = "rgba(60,64,80,0.45)"; g.lineWidth = 2;
    for (let x = 324; x < 352; x += 7) { g.beginPath(); g.moveTo(x, -R); g.lineTo(x, R); g.stroke(); }
    // eraser
    g.fillStyle = "#EE8F9C";
    g.beginPath(); g.moveTo(354, -R); g.lineTo(374, -R); g.quadraticCurveTo(386, -R, 386, -R + 12);
    g.lineTo(386, R - 12); g.quadraticCurveTo(386, R, 374, R); g.lineTo(354, R); g.closePath(); g.fill();
    g.fillStyle = "rgba(255,255,255,0.25)"; g.fillRect(356, -R + 4, 24, 5);
    // ink outline for a drawn look
    g.strokeStyle = "rgba(20,24,48,0.75)"; g.lineWidth = 2.5; g.lineJoin = "round";
    g.stroke(body);
    g.strokeRect(318, -R - 1, 36, R * 2 + 2);
    pencilSprite = { canvas: c, pad, R };
    return pencilSprite;
  }

  // tip at (x, y); angle points from the tip towards the eraser.
  function pencil(ctx, x, y, angle, scale, o) {
    o = o || {};
    const s = pencilSprite || buildPencil();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale || 1, scale || 1);
    ctx.drawImage(s.canvas, -s.pad, -s.pad - s.R);
    // face: two eyes on the body, looking where the pencil is heading
    const blink = o.blink || 0;
    const look = o.look == null ? Math.PI : o.look;
    const lx = Math.cos(look - angle) * 4, ly = Math.sin(look - angle) * 4;
    for (const ex of [196, 232]) {
      ctx.save();
      ctx.translate(ex, -2);
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.ellipse(0, 0, 11, 13 * (1 - blink * 0.9), 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(20,24,48,0.8)"; ctx.lineWidth = 2; ctx.stroke();
      if (blink < 0.7) {
        ctx.fillStyle = C.ink;
        ctx.beginPath(); ctx.arc(lx, ly, 5.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(lx - 1.6, ly - 1.8, 1.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    if (o.smile) {
      ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 3; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(214, 6, 9, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    }
    ctx.restore();
  }

  // Scissors centred on the pivot; angle is the cutting direction.
  function scissors(ctx, x, y, angle, open, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale || 1, scale || 1);
    ctx.shadowColor = "rgba(20,25,45,0.3)"; ctx.shadowBlur = 12; ctx.shadowOffsetX = 5; ctx.shadowOffsetY = 9;
    const half = (sign) => {
      ctx.save();
      ctx.rotate(sign * open * 0.32);
      const bl = ctx.createLinearGradient(0, -10, 0, 10);
      bl.addColorStop(0, "#F2F4F8"); bl.addColorStop(1, "#9AA1AE");
      ctx.fillStyle = bl;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.quadraticCurveTo(70, sign * -16, 150, sign * -2);
      ctx.quadraticCurveTo(80, sign * 6, -6, sign * 8);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(40,44,60,0.55)"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = C.red;
      ctx.beginPath(); ctx.ellipse(-62, sign * 26, 34, 24, sign * 0.4, 0, Math.PI * 2);
      ctx.ellipse(-62, sign * 26, 20, 12, sign * 0.4, 0, Math.PI * 2, true); ctx.fill("evenodd");
      ctx.fillRect(-36, sign * 4 - 6, 34, 12);
      ctx.restore();
    };
    half(1);
    half(-1);
    ctx.shadowColor = "transparent";
    ctx.fillStyle = "#5B6170"; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Magnifying glass: lens centred at (x, y), radius r. `inside` draws the magnified view.
  function magnifier(ctx, x, y, r, inside) {
    ctx.save();
    ctx.translate(x, y);
    // handle
    ctx.save();
    ctx.rotate(Math.PI / 4);
    ctx.shadowColor = "rgba(20,25,45,0.3)"; ctx.shadowBlur = 14; ctx.shadowOffsetX = 6; ctx.shadowOffsetY = 10;
    const hg = ctx.createLinearGradient(0, -16, 0, 16);
    hg.addColorStop(0, "#C88A52"); hg.addColorStop(1, "#8A5A2E");
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.roundRect(r + 6, -16, 170, 32, 14); ctx.fill();
    ctx.fillStyle = "#3A3F4D"; ctx.fillRect(r - 4, -12, 24, 24);
    ctx.restore();
    // lens contents
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
    if (inside) inside(ctx);
    ctx.fillStyle = "rgba(190, 215, 255, 0.10)"; ctx.fillRect(-r, -r, r * 2, r * 2);
    const gl = ctx.createRadialGradient(-r * 0.35, -r * 0.4, 2, -r * 0.35, -r * 0.4, r * 0.9);
    gl.addColorStop(0, "rgba(255,255,255,0.45)"); gl.addColorStop(0.35, "rgba(255,255,255,0.08)"); gl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gl; ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
    // rim
    ctx.lineWidth = 16; ctx.strokeStyle = "#2E3342";
    ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath(); ctx.arc(0, 0, r + 9, -2.6, -1.3); ctx.stroke();
    ctx.restore();
  }

  // Rubber stamp tool (handle up), bottom face centred at (x, y).
  function stampTool(ctx, x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale || 1, scale || 1);
    ctx.shadowColor = "rgba(20,25,45,0.32)"; ctx.shadowBlur = 18; ctx.shadowOffsetX = 8; ctx.shadowOffsetY = 14;
    ctx.fillStyle = "#7A4A26";
    ctx.beginPath(); ctx.roundRect(-150, -70, 300, 54, 10); ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.fillStyle = "#93603A"; ctx.fillRect(-150, -70, 300, 10);
    ctx.fillStyle = C.pencilDark; ctx.beginPath(); ctx.roundRect(-140, -18, 280, 18, 4); ctx.fill();
    const kg = ctx.createRadialGradient(-14, -200, 6, 0, -186, 70);
    kg.addColorStop(0, "#D49A62"); kg.addColorStop(1, "#7A4A26");
    ctx.fillStyle = "#86542D"; ctx.fillRect(-26, -150, 52, 84);
    ctx.fillStyle = kg; ctx.beginPath(); ctx.ellipse(0, -186, 64, 50, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Ink impression left by the stamp.
  function stampImpression(text, sub, color) {
    const w = 430, h = 150;
    return sprite(w, h, {
      shadow: false,
      seed: "stamp" + text,
      texture: makeCanvas(1, 1),
      draw: (g) => {
        g.clearRect(0, 0, w, h);
        g.strokeStyle = color; g.fillStyle = color;
        g.lineWidth = 9; g.beginPath(); g.roundRect(8, 8, w - 16, h - 16, 16); g.stroke();
        g.lineWidth = 3; g.beginPath(); g.roundRect(22, 22, w - 44, h - 44, 10); g.stroke();
        g.font = font(F.sans, 66, 700); g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(text, w / 2, h / 2 - (sub ? 10 : 0));
        if (sub) { g.font = font(F.type, 22, 700); g.fillText(sub, w / 2, h / 2 + 40); }
        // worn ink: knock out specks
        g.globalCompositeOperation = "destination-out";
        const r = rng("ink" + text);
        for (let i = 0; i < 520; i++) {
          g.globalAlpha = 0.25 + r() * 0.6;
          g.beginPath(); g.arc(r() * w, r() * h, 0.6 + r() * 2.6, 0, Math.PI * 2); g.fill();
        }
        g.globalAlpha = 0.18;
        g.fillRect(0, 0, w, h);
      },
    });
  }

  // A chain of paper dolls holding hands. Returns the outline for one doll.
  function dollPath(cx, base, s) {
    const p = new Path2D();
    const hd = 30 * s;
    p.arc(cx, base - 200 * s, hd, 0, Math.PI * 2);
    p.moveTo(cx - 14 * s, base - 172 * s);
    p.lineTo(cx + 14 * s, base - 172 * s);
    p.lineTo(cx + 22 * s, base - 160 * s);
    p.lineTo(cx + 70 * s, base - 146 * s);
    p.lineTo(cx + 70 * s, base - 128 * s);
    p.lineTo(cx + 30 * s, base - 132 * s);
    p.lineTo(cx + 54 * s, base - 54 * s);
    p.lineTo(cx + 22 * s, base - 54 * s);
    p.lineTo(cx + 22 * s, base);
    p.lineTo(cx + 6 * s, base);
    p.lineTo(cx + 2 * s, base - 54 * s);
    p.lineTo(cx - 2 * s, base - 54 * s);
    p.lineTo(cx - 6 * s, base);
    p.lineTo(cx - 22 * s, base);
    p.lineTo(cx - 22 * s, base - 54 * s);
    p.lineTo(cx - 54 * s, base - 54 * s);
    p.lineTo(cx - 30 * s, base - 132 * s);
    p.lineTo(cx - 70 * s, base - 128 * s);
    p.lineTo(cx - 70 * s, base - 146 * s);
    p.lineTo(cx - 22 * s, base - 160 * s);
    p.closePath();
    return p;
  }

  function dollChain(n, o) {
    const s = o.scale || 1;
    const step = 140 * s;
    const w = step * n, h = 240 * s;
    return sprite(w, h, {
      seed: "dolls" + n,
      tex: { base: o.base || C.news, newsprint: true, seed: "dollpaper" },
      shape: (pad) => {
        const p = new Path2D();
        for (let i = 0; i < n; i++) p.addPath(dollPath(pad + step * (i + 0.5), pad + h - 2, s));
        return p;
      },
      draw: (g) => {
        // fold creases where the hands meet
        g.strokeStyle = "rgba(60,50,40,0.18)"; g.lineWidth = 1.5;
        for (let i = 1; i < n; i++) { const x = step * i; g.beginPath(); g.moveTo(x, h - 146 * s); g.lineTo(x, h - 126 * s); g.stroke(); }
        // each doll holds the same little card
        for (let i = 0; i < n; i++) {
          const cx = step * (i + 0.5);
          g.save();
          g.translate(cx, h - 112 * s);
          g.rotate(-0.06);
          g.fillStyle = C.card; g.fillRect(-26 * s, -18 * s, 52 * s, 36 * s);
          g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 1; g.strokeRect(-26 * s, -18 * s, 52 * s, 36 * s);
          g.fillStyle = "rgba(40,40,60,0.45)";
          for (let k = 0; k < 3; k++) g.fillRect(-20 * s, (-10 + k * 9) * s, (k === 2 ? 26 : 40) * s, 3 * s);
          g.restore();
        }
      },
    });
  }

  // The one doll that's you: yellow paper, a face, and the note in hand.
  function youDoll(scale) {
    const s = scale || 1;
    const w = 180 * s, h = 250 * s;
    return sprite(w, h, {
      seed: "you",
      tex: { base: C.mustard, seed: "youpaper" },
      shape: (pad) => dollPath(pad + w / 2, pad + h - 2, s),
      draw: (g) => {
        const cx = w / 2, base = h - 2;
        g.fillStyle = C.ink;
        g.beginPath(); g.arc(cx - 10 * s, base - 204 * s, 3.4 * s, 0, Math.PI * 2); g.arc(cx + 10 * s, base - 204 * s, 3.4 * s, 0, Math.PI * 2); g.fill();
        g.strokeStyle = C.ink; g.lineWidth = 3 * s; g.lineCap = "round";
        g.beginPath(); g.arc(cx, base - 196 * s, 11 * s, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
        g.fillStyle = "rgba(225,90,80,0.45)";
        g.beginPath(); g.arc(cx - 19 * s, base - 192 * s, 5 * s, 0, Math.PI * 2); g.arc(cx + 19 * s, base - 192 * s, 5 * s, 0, Math.PI * 2); g.fill();
        g.strokeStyle = "rgba(31,36,51,0.85)"; g.lineWidth = 4 * s;
        g.beginPath(); g.moveTo(cx - 26 * s, base - 214 * s); g.quadraticCurveTo(cx - 10 * s, base - 238 * s, cx + 4 * s, base - 226 * s);
        g.quadraticCurveTo(cx + 18 * s, base - 240 * s, cx + 27 * s, base - 214 * s); g.stroke();
      },
    });
  }

  // Crumpled paper ball.
  function paperBall(r, seed) {
    const n = 15;
    const rr = rng("ball" + seed);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rad = r * (0.8 + rr() * 0.25);
      pts.push([r + Math.cos(a) * rad, r + Math.sin(a) * rad]);
    }
    return sprite(r * 2, r * 2, {
      seed: "ballsp" + seed,
      shape: (pad) => pathFrom(pts, pad, pad),
      draw: (g) => {
        for (let i = 0; i < 22; i++) {
          const a = pts[Math.floor(rr() * n)], b = pts[Math.floor(rr() * n)];
          g.fillStyle = `rgba(${rr() > 0.5 ? "255,255,255" : "60,60,80"},${0.06 + rr() * 0.12})`;
          g.beginPath(); g.moveTo(r, r); g.lineTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.closePath(); g.fill();
        }
        g.strokeStyle = "rgba(60,60,80,0.25)"; g.lineWidth = 1.5;
        for (let i = 0; i < 9; i++) {
          g.beginPath(); g.moveTo(rr() * r * 2, rr() * r * 2); g.lineTo(rr() * r * 2, rr() * r * 2); g.stroke();
        }
      },
    });
  }

  // The chatbot: a little die-cut sticker. Mouth open or shut.
  function botSticker(open) {
    const w = 170, h = 170;
    return sprite(w, h, {
      seed: "bot",
      shadowBlur: 10,
      shape: (pad) => { const p = new Path2D(); p.roundRect(pad, pad, w, h, 36); return p; },
      draw: (g) => {
        g.fillStyle = "#C9D3E3";
        g.beginPath(); g.roundRect(14, 30, w - 28, h - 44, 26); g.fill();
        g.strokeStyle = "#5C677E"; g.lineWidth = 4;
        g.beginPath(); g.moveTo(w / 2, 30); g.lineTo(w / 2, 14); g.stroke();
        g.fillStyle = C.red; g.beginPath(); g.arc(w / 2, 12, 8, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#2D3446";
        g.fillRect(44, 66, 24, 20); g.fillRect(w - 68, 66, 24, 20);
        g.fillStyle = "#7BE0C9";
        g.fillRect(48, 70, 8, 8); g.fillRect(w - 64, 70, 8, 8);
        g.fillStyle = "#2D3446";
        if (open) { g.beginPath(); g.roundRect(56, 104, w - 112, 30, 8); g.fill(); g.fillStyle = "#E06A6A"; g.fillRect(64, 122, w - 128, 8); }
        else { g.fillRect(56, 114, w - 112, 8); }
        g.strokeStyle = "rgba(60,70,90,0.35)"; g.lineWidth = 2;
        for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(26, 98 + i * 10); g.lineTo(36, 98 + i * 10); g.moveTo(w - 36, 98 + i * 10); g.lineTo(w - 26, 98 + i * 10); g.stroke(); }
      },
    });
  }

  // Biscuit the dog, doodled on an instant photo.
  function polaroid() {
    const w = 250, h = 290;
    return sprite(w, h, {
      seed: "polaroid",
      tex: { base: "#FCFBF7", seed: "pol" },
      draw: (g) => {
        const sky = g.createLinearGradient(0, 20, 0, 230);
        sky.addColorStop(0, "#BFD8F7"); sky.addColorStop(1, "#EAF2FB");
        g.fillStyle = sky; g.fillRect(20, 20, w - 40, 200);
        g.fillStyle = "#9CC98B"; g.beginPath(); g.moveTo(20, 175); g.quadraticCurveTo(w / 2, 150, w - 20, 172); g.lineTo(w - 20, 220); g.lineTo(20, 220); g.fill();
        // dog
        g.save();
        g.translate(w / 2, 150);
        g.lineWidth = 4; g.strokeStyle = C.ink; g.lineJoin = "round"; g.lineCap = "round";
        g.fillStyle = "#E6B97A";
        g.beginPath(); g.ellipse(0, 40, 62, 34, 0, Math.PI, 2 * Math.PI); g.fill(); g.stroke();
        g.beginPath(); g.ellipse(0, -12, 50, 44, 0, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = "#9A6A3A";
        g.beginPath(); g.ellipse(-48, -6, 16, 30, 0.35, 0, Math.PI * 2); g.fill(); g.stroke();
        g.beginPath(); g.ellipse(48, -6, 16, 30, -0.35, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = "#F6E2C2"; g.beginPath(); g.ellipse(0, 6, 26, 19, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = C.ink;
        g.beginPath(); g.arc(-17, -22, 5, 0, Math.PI * 2); g.arc(17, -22, 5, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.ellipse(0, -2, 9, 6.5, 0, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.moveTo(0, 4); g.lineTo(0, 12); g.moveTo(-10, 14); g.quadraticCurveTo(0, 20, 10, 14); g.stroke();
        g.fillStyle = "#E56A79"; g.beginPath(); g.ellipse(4, 22, 7, 9, 0.1, 0, Math.PI * 2); g.fill();
        g.fillStyle = C.red; g.fillRect(-30, 26, 60, 9);
        g.fillStyle = C.mustard; g.beginPath(); g.arc(0, 38, 6, 0, Math.PI * 2); g.fill();
        g.restore();
        g.font = font(F.hand, 40, 700); g.fillStyle = C.ink; g.textAlign = "center";
        g.fillText("Biscuit!", w / 2, 266);
      },
    });
  }

  // Small doodled icons for the method cards (drawn into a sprite).
  function methodIcon(g, kind, x, y) {
    g.save();
    g.translate(x, y);
    g.strokeStyle = C.pencil; g.fillStyle = C.pencil; g.lineWidth = 3.5; g.lineJoin = "round"; g.lineCap = "round";
    if (kind === "pyramid" || kind === "inverted") {
      const s = kind === "pyramid" ? 1 : -1;
      g.beginPath(); g.moveTo(0, -24 * s); g.lineTo(28, 22 * s); g.lineTo(-28, 22 * s); g.closePath(); g.stroke();
      g.beginPath(); g.moveTo(-14, 0); g.lineTo(14, 0); g.stroke();
    } else if (kind === "scqa") {
      ["S", "C", "Q", "A"].forEach((ch, i) => {
        g.strokeRect(-46 + i * 24, -12, 20, 24);
        g.font = font(F.type, 16, 700); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(ch, -36 + i * 24, 1);
      });
    } else if (kind === "mece") {
      g.strokeRect(-24, -24, 22, 22); g.strokeRect(2, -24, 22, 22); g.strokeRect(-24, 2, 22, 22); g.strokeRect(2, 2, 22, 22);
    } else if (kind === "wwb") {
      g.beginPath(); g.moveTo(-30, -8); g.lineTo(30, -8); g.stroke();
      g.beginPath(); g.moveTo(-30, 10); g.lineTo(6, 10); g.stroke();
      g.strokeStyle = C.red; g.beginPath(); g.moveTo(-34, -14); g.lineTo(34, -2); g.stroke();
    } else if (kind === "data") {
      [[-24, 10], [-8, -6], [8, 4], [24, -20]].forEach(([bx, top]) => g.fillRect(bx - 6, top, 12, 24 - top));
      g.beginPath(); g.moveTo(-32, 24); g.lineTo(34, 24); g.stroke();
    }
    g.restore();
  }

  // A word cut from a magazine: its own scrap of paper and its own typeface.
  const CLIP_STYLES = [
    { family: F.display, weight: 400, size: 64, bg: C.white, fg: C.ink },
    { family: F.type, weight: 700, size: 58, bg: C.news, fg: C.ink, tex: { newsprint: false } },
    { family: F.sans, weight: 700, size: 58, bg: C.yellow, fg: C.ink },
    { family: F.display, weight: 400, size: 66, bg: C.ink, fg: C.white },
    { family: F.sans, weight: 700, size: 56, bg: C.white, fg: C.red },
    { family: F.type, weight: 700, size: 58, bg: C.sky, fg: C.pencilDark },
    { family: F.display, weight: 400, size: 64, bg: C.blush, fg: C.ink },
  ];

  let measureCtx = null;
  function measure(text, f) {
    if (!measureCtx) measureCtx = makeCanvas(4, 4).getContext("2d");
    measureCtx.font = f;
    return measureCtx.measureText(text).width;
  }

  function clipping(text, seed, styleIndex) {
    const r = rng("clip" + seed);
    const st = CLIP_STYLES[styleIndex == null ? Math.floor(r() * CLIP_STYLES.length) : styleIndex % CLIP_STYLES.length];
    const f = font(st.family, st.size, st.weight);
    const tw = measure(text, f);
    const padX = 14 + r() * 8, padY = 10 + r() * 6;
    const w = tw + padX * 2, h = st.size * 1.08 + padY * 2;
    return sprite(w, h, {
      seed: "clipsp" + seed,
      shadowBlur: 8,
      torn: { left: r() > 0.6, right: r() > 0.6 },
      rough: 0.6,
      tex: Object.assign({ base: st.bg, seed: "cliptex" + seed, fibers: 6 }, st.tex || {}),
      draw: (g) => {
        g.font = f; g.fillStyle = st.fg; g.textBaseline = "middle";
        g.fillText(text, padX, h / 2 + st.size * 0.05);
      },
    });
  }

  // A handwritten note on a scrap of paper (sticky note, torn corner or tape).
  function scrapLabel(text, o) {
    o = o || {};
    const size = o.size || 52;
    const f = font(o.family || F.hand, size, 700);
    const tw = measure(text, f);
    const w = tw + 46, h = size * 1.35;
    return sprite(w, h, {
      seed: "scrap" + text,
      shadowBlur: 10,
      torn: o.torn || { right: true },
      rough: 0.7,
      tex: { base: o.base || C.white, seed: "scrapt" + text, fibers: 10 },
      draw: (g) => {
        g.font = f; g.fillStyle = o.color || C.ink; g.textBaseline = "middle";
        g.fillText(text, 22, h / 2 + size * 0.06);
      },
    });
  }

  // One letter of the title, ransom-note style.
  function letterScrap(ch, seed) {
    const r = rng("letter" + seed);
    const styles = [
      { family: F.display, weight: 400, bg: C.white, fg: C.ink },
      { family: F.sans, weight: 700, bg: C.ink, fg: C.legal },
      { family: F.type, weight: 700, bg: C.sky, fg: C.pencilDark },
      { family: F.display, weight: 400, bg: C.red, fg: C.white },
      { family: F.sans, weight: 700, bg: C.white, fg: C.pencil },
      { family: F.display, weight: 400, bg: C.kraft, fg: C.ink },
      { family: F.type, weight: 700, bg: C.news, fg: C.ink },
      { family: F.sans, weight: 700, bg: C.pencil, fg: C.white },
    ];
    const st = styles[hash(seed) % styles.length];
    const size = 118 + Math.floor(r() * 26);
    const f = font(st.family, size, st.weight);
    const tw = measure(ch, f);
    const w = Math.max(tw + 34, size * 0.72), h = size * 1.12;
    return sprite(w, h, {
      seed: "lsp" + seed,
      shadowBlur: 10,
      torn: { top: r() > 0.5, bottom: r() > 0.5, left: r() > 0.7, right: r() > 0.7 },
      rough: 0.8,
      tex: { base: st.bg, seed: "ltex" + seed, fibers: 8, newsprint: st.bg === C.news },
      draw: (g) => {
        g.font = f; g.fillStyle = st.fg; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(ch, w / 2, h / 2 + size * 0.06);
      },
    });
  }

  // ------------------------------------------------------------------
  // Finishing: vignette and film grain over the whole frame.
  // ------------------------------------------------------------------
  let vignetteCanvas = null;
  function vignette(ctx) {
    if (!vignetteCanvas) {
      vignetteCanvas = makeCanvas(W, H);
      const g = vignetteCanvas.getContext("2d");
      const gr = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.05);
      gr.addColorStop(0, "rgba(30,25,20,0)");
      gr.addColorStop(1, "rgba(30,25,20,0.26)");
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
    ctx.drawImage(vignetteCanvas, 0, 0);
  }

  function filmGrain(ctx, frame) {
    const r = rng("fg" + (frame % 8));
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.globalCompositeOperation = "overlay";
    ctx.fillStyle = ctx.createPattern(grain(), "repeat");
    ctx.translate(Math.floor(r() * 256), Math.floor(r() * 256));
    ctx.fillRect(-256, -256, W + 512, H + 512);
    ctx.restore();
  }

  root.WordsmithFilmKit = {
    W, H, C, F, hash, rng, clamp, lerp, prog, ease, font, makeCanvas, measure,
    paperTexture, matTexture, scrapLabel, sprite, place, tape, sketch, partial, loopPoints, linePoints, handText,
    pencil, buildPencil, scissors, magnifier, stampTool, stampImpression, dollChain, youDoll,
    paperBall, botSticker, polaroid, methodIcon, clipping, letterScrap, vignette, filmGrain,
  };
})(typeof window !== "undefined" ? window : this);
