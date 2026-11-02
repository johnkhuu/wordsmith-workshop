// Unit tests for the explainer film's timeline, voiceover, score and script.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The film modules attach themselves to `window`, as in the browser.
global.window = global;
require("../../assets/film/film-kit.js");
require("../../assets/film/film-scenes.js");
require("../../assets/film/film-audio.js");
const { scan } = require("../../assets/scanner.js");

const S = global.WordsmithFilmScenes;
const AUD = global.WordsmithFilmAudio;
const ROOT = path.join(__dirname, "..", "..");
const VO = path.join(ROOT, "assets", "film", "vo");
const durations = JSON.parse(fs.readFileSync(path.join(VO, "durations.json"), "utf8"));

test("the film runs between 15 and 30 seconds", () => {
  assert.ok(S.DURATION >= 15 && S.DURATION <= 30, `${S.DURATION}s`);
});

test("every line has a voice clip, and the timeline uses its real length", () => {
  for (const c of S.CUES) {
    assert.ok(fs.existsSync(path.join(VO, c.id + ".mp3")), `missing ${c.id}.mp3`);
    assert.ok(Math.abs(c.dur - durations[c.id]) < 0.02, `${c.id}: timeline says ${c.dur}s, clip is ${durations[c.id]}s`);
  }
  assert.deepEqual(Object.keys(durations).sort(), S.CUES.map((c) => c.id).sort());
});

test("lines are in order, never overlap, and finish before the end", () => {
  for (let i = 0; i < S.CUES.length; i++) {
    const c = S.CUES[i];
    assert.ok(c.at >= 0 && c.at + c.dur <= S.DURATION - 1, `${c.id} runs past the end`);
    if (i > 0) {
      const prev = S.CUES[i - 1];
      assert.ok(c.at >= prev.at + prev.dur + 0.08, `${c.id} starts before ${prev.id} ends`);
    }
  }
});

test("the transcript on the page matches the captions", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const block = html.split('class="film-transcript"')[1].split("</ol>")[0];
  const lines = [...block.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) =>
    m[1].replace(/<span class="who">[^<]*<\/span>/, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
  assert.deepEqual(lines, S.CUES.map((c) => c.text));
});

test("the narration passes the scanner, and the chatbot's lines don't", () => {
  const narration = S.CUES.filter((c) => c.voice === "narrator").map((c) => c.text).join(" ");
  const n = scan(narration);
  assert.equal(n.counts.strong + n.counts.moderate, 0, n.findings.map((f) => f.code + " " + f.match).join("; "));
  const bot = S.CUES.filter((c) => c.voice === "bot").map((c) => c.text).join(" ");
  assert.ok(scan(bot).counts.strong > 0, "the chatbot lines should trip the scanner");
});

test("every note and sound effect lands inside the film", () => {
  const ev = AUD.cueSheet();
  assert.ok(ev.length > 300);
  for (const e of ev) assert.ok(e.t >= 0 && e.t < S.DURATION - 0.5, `${e.inst} at ${e.t}`);
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i].t >= ev[i - 1].t, "cue sheet is sorted");
});

test("the plucked strings are in tune", () => {
  const { pluck, hz } = AUD._dsp;
  const sr = 48000;
  const peak = (x, guess) => {
    let best = 0, bf = 0;
    const n = Math.min(x.length, sr / 2);
    for (let f = guess * 0.97; f <= guess * 1.03; f += guess * 0.0002) {
      let re = 0, im = 0;
      for (let i = 0; i < n; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
        re += x[i] * w * Math.cos((2 * Math.PI * f * i) / sr);
        im += x[i] * w * Math.sin((2 * Math.PI * f * i) / sr);
      }
      if (re * re + im * im > best) { best = re * re + im * im; bf = f; }
    }
    return bf;
  };
  for (const m of [41, 65, 69, 84]) {
    const want = hz(m);
    const cents = 1200 * Math.log2(peak(pluck(sr, want, 0.6, {}), want) / want);
    assert.ok(Math.abs(cents) < 3, `MIDI ${m} is ${cents.toFixed(1)} cents out`);
  }
});

test("the chatbot's words land while it's speaking", () => {
  const bot = S.CUES.filter((c) => c.voice === "bot");
  const first = bot[0].at, last = bot[bot.length - 1].at + bot[bot.length - 1].dur;
  for (const t of S.WORD_TIMES) assert.ok(t >= first && t <= last, `word at ${t}`);
});
