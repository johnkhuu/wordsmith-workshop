// End-to-end tests: load the real page in Chromium and use it like a visitor.
// Requests to other hosts (Google Fonts) get an empty reply, so the tests
// don't depend on the network and the fallback fonts are used.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { start } = require("../support/server.js");
const { scan } = require("../../assets/scanner.js");

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

async function open({ width = 1280, height = 900, scheme = "light", reducedMotion = "no-preference" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, reducedMotion });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(site.url)) return route.continue();
    return route.fulfill({ status: 200, contentType: "text/css", body: "" });
  });
  await page.goto(site.url);
  await page.waitForSelector("#findings .finding");
  return { page, context, errors };
}

async function waitForVerdict(page, prefix) {
  await page.waitForFunction(
    (p) => document.getElementById("verdict").textContent.startsWith(p), prefix, { timeout: 5000 });
}

async function tileCounts(page) {
  return page.$$eval(".tile-n", (els) => els.map((e) => Number(e.textContent)));
}

test("loads without errors and has the right title", async () => {
  const { page, context, errors } = await open();
  assert.equal(await page.title(), "Wordsmith Workshop");
  assert.deepEqual(errors, []);
  await context.close();
});

test("every nav link points at a section that exists", async () => {
  const { page, context } = await open();
  const missing = await page.$$eval(".site-nav a, .cta-row a, a.brand", (links) =>
    links.map((a) => a.getAttribute("href")).filter((h) => h.startsWith("#") && !document.querySelector(h)));
  assert.deepEqual(missing, []);
  await context.close();
});

test("the report agrees with the scanner for the loaded sample", async () => {
  const { page, context } = await open();
  const text = await page.inputValue("#scan-input");
  const r = scan(text);
  assert.ok(r.counts.strong > 0, "the 'before' sample should have strong hits");
  assert.deepEqual(await tileCounts(page), [r.counts.strong, r.counts.moderate, r.counts.weak]);
  assert.equal(await page.locator("#findings .finding").count(), r.findings.length);
  await waitForVerdict(page, `${r.counts.strong} strong hit`);
  assert.equal(await page.getAttribute("#load-before", "aria-pressed"), "true");
  await context.close();
});

test("every finding in the report can be found in the text", async () => {
  // Regression: overlapping hits used to hide some marks, so clicking those findings did nothing.
  const { page, context } = await open();
  const orphans = await page.$$eval("button.finding", (buttons) =>
    buttons.filter((b) => !document.querySelector(`#scan-backdrop mark[data-ids~="${b.dataset.i}"]`))
      .map((b) => b.querySelector(".code").textContent));
  assert.deepEqual(orphans, []);
  await context.close();
});

test("clicking a finding flashes its place in the text", async () => {
  const { page, context } = await open();
  const btn = page.locator("button.finding", { hasText: "Significance / legacy puffing" }).first();
  const i = await btn.getAttribute("data-i");
  await btn.click();
  const flashed = await page.$$eval(`#scan-backdrop mark[data-ids~="${i}"]`,
    (marks) => marks.length > 0 && marks.every((m) => m.classList.contains("is-flash")));
  assert.ok(flashed);
  await context.close();
});

test("the flash still shows with reduced motion", async () => {
  const { page, context } = await open({ reducedMotion: "reduce" });
  const btn = page.locator("button.finding").first();
  const i = await btn.getAttribute("data-i");
  const mark = `#scan-backdrop mark[data-ids~="${i}"]`;
  const bgOf = () => page.$eval(mark, (m) => getComputedStyle(m).backgroundColor);
  const before = await bgOf();
  await btn.click();
  const during = await bgOf();
  const tint = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = "var(--pencil-tint)";
    document.body.append(probe);
    const c = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return c;
  });
  assert.notEqual(during, before, "the mark should change when flashed");
  assert.equal(during, tint);
  await context.close();
});

test("clicking a finding leaves the highlights on their words", async () => {
  const { page, context } = await open({ width: 390, height: 600 });
  // Click the last finding so the page has to scroll a long way.
  await page.locator("button.finding").last().click();
  await page.waitForTimeout(800);
  assert.equal(await page.$eval("#scan-backdrop", (el) => el.scrollTop), 0);
  await context.close();
});

test("the 'after' sample comes back clean", async () => {
  const { page, context } = await open();
  await page.click("#load-after");
  await waitForVerdict(page, "No strong or moderate hits");
  const [strong, moderate] = await tileCounts(page);
  assert.equal(strong, 0);
  assert.equal(moderate, 0);
  assert.equal(await page.getAttribute("#load-after", "aria-pressed"), "true");
  assert.equal(await page.getAttribute("#load-before", "aria-pressed"), "false");
  await context.close();
});

test("typing rescans the text", async () => {
  const { page, context } = await open();
  await page.fill("#scan-input", "Hi Jo,\n\nI hope this helps!");
  await waitForVerdict(page, "1 strong hit");
  assert.equal(await page.locator("#findings .code", { hasText: "D6" }).count(), 1);
  assert.equal(await page.getAttribute("#load-before", "aria-pressed"), "false");
  await context.close();
});

test("the Writing Without Bullshit switch adds its checks", async () => {
  const { page, context } = await open();
  assert.equal(await page.locator("#stats dt", { hasText: "Weasel words" }).count(), 0);
  await page.check("#wwb");
  await page.waitForSelector("#stats dt:has-text('Weasel words')");
  const codes = await page.$$eval("#findings .code", (els) => els.map((e) => e.textContent));
  assert.ok(codes.includes("W3"), "the sample's intensifiers should be flagged");
  await context.close();
});

test("Clear empties the report and focuses the text box", async () => {
  const { page, context } = await open();
  await page.click("#clear-text");
  await waitForVerdict(page, "Paste or type something to scan it.");
  assert.equal(await page.locator("#findings .finding").count(), 0);
  assert.deepEqual(await tileCounts(page), [0, 0, 0]);
  assert.equal(await page.evaluate(() => document.activeElement.id), "scan-input");
  await context.close();
});

test("pasted text is shown as text, never run as HTML", async () => {
  const { page, context } = await open();
  await page.fill("#scan-input", '<img src=x onerror="window.__pwned=1"> <b>bold</b> <script>window.__pwned=2</script>');
  await page.waitForFunction(() => document.getElementById("scan-backdrop").textContent.includes("<img"));
  const html = await page.$eval("#scan-backdrop", (el) => ({ img: el.querySelector("img"), b: el.querySelector("b"), s: el.querySelector("script") }));
  assert.deepEqual(html, { img: null, b: null, s: null });
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  await context.close();
});

for (const width of [1280, 390]) {
  test(`highlights line up with the text at ${width}px`, async () => {
    const { page, context } = await open({ width });
    const m = await page.evaluate(() => {
      const ta = document.getElementById("scan-input");
      const bd = document.getElementById("scan-backdrop");
      const props = ["fontFamily", "fontSize", "lineHeight", "letterSpacing", "paddingTop", "paddingLeft",
        "paddingRight", "whiteSpace", "overflowWrap", "tabSize"];
      const a = getComputedStyle(ta);
      const b = getComputedStyle(bd);
      return {
        mismatched: props.filter((p) => a[p] !== b[p]),
        sameText: bd.textContent === ta.value,
        heights: [ta.offsetHeight, bd.offsetHeight],
        widths: [ta.clientWidth, bd.clientWidth],
        scrollHidden: ta.scrollHeight <= ta.clientHeight + 1,
      };
    });
    assert.deepEqual(m.mismatched, []);
    assert.ok(m.sameText, "backdrop text should match the text box");
    assert.equal(m.heights[0], m.heights[1]);
    assert.equal(m.widths[0], m.widths[1]);
    assert.ok(m.scrollHidden, "the text box should grow instead of scrolling");
    await context.close();
  });
}

test("the text box stays at 16px or more on phones, so iOS doesn't zoom", async () => {
  const { page, context } = await open({ width: 390, height: 844 });
  const size = await page.$eval("#scan-input", (el) => parseFloat(getComputedStyle(el).fontSize));
  assert.ok(size >= 16, `font-size is ${size}px`);
  await context.close();
});

for (const scheme of ["light", "dark"]) {
  for (const width of [320, 390, 768, 1280]) {
    test(`no sideways scrolling at ${width}px in ${scheme} mode`, async () => {
      const { page, context } = await open({ width, scheme });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `page is ${overflow}px too wide`);
      await context.close();
    });
  }
}

test("dark mode changes the palette, and an explicit light theme wins over it", async () => {
  const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await open({ scheme: "light" });
  const dark = await open({ scheme: "dark" });
  const lightBg = await bg(light.page);
  const darkBg = await bg(dark.page);
  assert.notEqual(lightBg, darkBg);
  await dark.page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  assert.equal(await bg(dark.page), lightBg);
  await light.context.close();
  await dark.context.close();
});

test("the page's own copy passes the scanner", async () => {
  // A site about avoiding AI tells shouldn't have any. Quoted examples of
  // tells, the struck-out "before" email and the scanner itself are skipped.
  const { page, context } = await open();
  const copy = await page.evaluate(() => {
    const skip = ".sheet-before, q, del, .scan-grid, .scan-controls, script, style, nav";
    const blocks = document.querySelectorAll("main p, main h1, main h2, main h3, main li, main th, main td, footer p");
    const out = [];
    for (const el of blocks) {
      if (el.closest(skip)) continue;
      const clone = el.cloneNode(true);
      clone.querySelectorAll(skip).forEach((n) => n.remove());
      const t = clone.textContent.replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    }
    return out.join("\n\n");
  });
  const r = scan(copy);
  const hits = r.findings.filter((f) => f.severity !== "weak").map((f) => `${f.code} ${f.match}`);
  assert.ok(r.words > 800, "expected to collect the page copy");
  assert.deepEqual(hits, []);
  await context.close();
});
