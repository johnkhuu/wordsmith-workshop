// Browser tests for the explainer film's player.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { start } = require("../support/server.js");

let browser;
let site;

before(async () => {
  site = await start();
  browser = await chromium.launch();
});

after(async () => {
  if (browser) await browser.close();
  if (site) site.server.close();
});

async function open(opts = {}) {
  const context = await browser.newContext({ viewport: { width: opts.width || 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(site.url)) return route.continue();
    return route.fulfill({ status: 200, contentType: "text/css", body: "" });
  });
  await page.goto(site.url + "#film");
  await page.waitForFunction(() => document.querySelector("[data-film]") && document.querySelector("[data-film]").film);
  return { page, context, errors };
}

const film = (page, expr) => page.evaluate(new Function("return (" + expr + ")(document.querySelector('[data-film]').film)"));
const caption = (page) => page.evaluate(() => {
  const c = document.querySelector(".film-caption");
  return c.hidden ? "" : c.textContent;
});

test("the film draws a poster frame before anyone presses play", async () => {
  const { page, context, errors } = await open();
  await page.waitForFunction(() => {
    const c = document.querySelector(".film-canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 997) seen.add(d[i] >> 4 << 8 | d[i + 1] >> 4 << 4 | d[i + 2] >> 4);
    return seen.size > 20;
  }, null, { timeout: 8000 });
  assert.equal(await page.isVisible(".film-big-play"), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test("play starts the film, with captions in step with the voice", async () => {
  const { page, context, errors } = await open();
  await page.click(".film-big-play");
  await page.waitForFunction(() => document.querySelector("[data-film]").film.time > 1.2, null, { timeout: 8000 });
  assert.equal(await film(page, "(f) => f.playing"), true);
  assert.equal(await page.getAttribute(".film-toggle", "aria-label"), "Pause");
  assert.equal(await caption(page), "You've read this email a thousand times.");
  assert.equal(await page.isVisible(".film-big-play"), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test("seeking moves the picture and the captions", async () => {
  const { page, context } = await open();
  await page.click(".film-big-play");
  await page.waitForFunction(() => document.querySelector("[data-film]").film.playing);
  await film(page, "(f) => f.pause()");
  await film(page, "(f) => f.seek(19)");
  await page.waitForFunction(() => document.querySelector(".film-time").textContent.startsWith("0:19"));
  assert.equal(await caption(page), "then checks every line for the tells that give a chatbot away.");
  await film(page, "(f) => f.seek(4)");
  await page.waitForFunction(() => document.querySelector(".film-caption").textContent.includes("finds you well"));
  await context.close();
});

test("pause stops the clock, and captions can be switched off", async () => {
  const { page, context } = await open();
  await page.click(".film-big-play");
  await page.waitForFunction(() => document.querySelector("[data-film]").film.time > 0.8, null, { timeout: 8000 });
  await page.click(".film-toggle");
  const t1 = await film(page, "(f) => f.time");
  await page.waitForTimeout(400);
  assert.equal(await film(page, "(f) => f.time"), t1);
  assert.equal(await page.getAttribute(".film-toggle", "aria-label"), "Play");
  await page.click(".film-cc");
  assert.equal(await page.getAttribute(".film-cc", "aria-pressed"), "false");
  assert.equal(await caption(page), "");
  await page.click(".film-mute");
  assert.equal(await page.getAttribute(".film-mute", "aria-pressed"), "true");
  assert.equal(await page.getAttribute(".film-mute", "aria-label"), "Unmute");
  await context.close();
});

test("the film ends on a replay button", async () => {
  const { page, context } = await open();
  await page.click(".film-big-play");
  await page.waitForFunction(() => document.querySelector("[data-film]").film.playing);
  await film(page, "(f) => f.seek(29.2)");
  await page.waitForFunction(() => document.querySelector(".film-toggle").getAttribute("aria-label") === "Replay", null, { timeout: 5000 });
  assert.equal(await film(page, "(f) => f.playing"), false);
  await context.close();
});

test("the k key plays and pauses from anywhere in the player", async () => {
  const { page, context } = await open();
  await page.focus(".film-seek");
  await page.keyboard.press("k");
  await page.waitForFunction(() => document.querySelector("[data-film]").film.playing, null, { timeout: 8000 });
  await page.keyboard.press("k");
  assert.equal(await film(page, "(f) => f.playing"), false);
  await context.close();
});

test("the player fits a phone screen", async () => {
  const { page, context } = await open({ width: 360 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `page is ${overflow}px too wide`);
  const box = await page.locator(".film-stage").boundingBox();
  assert.ok(box.width <= 360 && box.height > 150);
  await context.close();
});
