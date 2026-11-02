#!/usr/bin/env node
// Export the explainer film as a 1080p MP4 with sound, for sharing outside the site.
//
// It renders every pose of the film in Chromium (the same code the site runs),
// renders the same audio mix offline, and encodes both with ffmpeg.
//
// Usage: node tools/film/export_video.js out/wordsmith-workshop-film.mp4
// Needs: npm ci, npx playwright install chromium, and ffmpeg on the PATH.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { start } = require("../../tests/support/server.js");

const OUT = path.resolve(process.argv[2] || "wordsmith-workshop-film.mp4");
const FONTS = "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Caveat:wght@600;700&family=Courier+Prime:wght@400;700&family=Gloock&display=swap";

(async () => {
  const site = await start();
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: "127.0.0.1,localhost" } } : {});
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(site.url + "index.html");
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${FONTS}"></head>
    <body style="margin:0"><canvas id="c" width="1920" height="1080"></canvas>
    <script src="${site.url}assets/film/film-kit.js"></script>
    <script src="${site.url}assets/film/film-scenes.js"></script>
    <script src="${site.url}assets/film/film-audio.js"></script></body></html>`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await Promise.all(["700 40px Caveat", "600 40px Caveat", "400 40px Gloock", "700 40px 'Courier Prime'",
      "700 40px 'Atkinson Hyperlegible'", "400 40px 'Atkinson Hyperlegible'"].map((f) => document.fonts.load(f)));
    window.WordsmithFilmScenes.build();
  });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "film-"));
  const { FPS, DURATION } = await page.evaluate(() => ({ FPS: window.WordsmithFilmScenes.FPS, DURATION: window.WordsmithFilmScenes.DURATION }));
  const frames = Math.ceil(DURATION * FPS);
  for (let i = 0; i < frames; i++) {
    const data = await page.evaluate((t) => {
      const c = document.getElementById("c");
      window.WordsmithFilmScenes.renderFrame(c.getContext("2d"), t);
      return c.toDataURL("image/png");
    }, i / FPS);
    fs.writeFileSync(path.join(dir, String(i).padStart(4, "0") + ".png"), Buffer.from(data.split(",")[1], "base64"));
    if (i % 60 === 0) process.stdout.write(`frames ${i}/${frames}\n`);
  }

  const wavB64 = await page.evaluate(async (base) => {
    const buf = await window.WordsmithFilmAudio.renderOffline(base, 48000);
    const L = buf.getChannelData(0), R = buf.getChannelData(1), n = buf.length;
    const v = new DataView(new ArrayBuffer(44 + n * 4));
    const w = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + n * 4, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, 48000, true); v.setUint32(28, 192000, true);
    v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) {
      v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
      v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
    }
    const bytes = new Uint8Array(v.buffer);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, site.url + "assets/film/vo/");
  const wav = path.join(dir, "mix.wav");
  fs.writeFileSync(wav, Buffer.from(wavB64, "base64"));
  await browser.close();
  site.server.close();
  if (errors.length) throw new Error("Errors while rendering: " + errors.join(" | "));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
    "-framerate", String(FPS), "-i", path.join(dir, "%04d.png"), "-i", wav,
    "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-tune", "animation",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", OUT], { stdio: "inherit" });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("wrote", OUT);
})().catch((e) => { console.error(e); process.exit(1); });
