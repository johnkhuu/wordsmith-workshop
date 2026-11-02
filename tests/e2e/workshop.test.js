// Browser tests for the workshop: paste a draft, pick methods, shape it, copy it.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { start } = require("../support/server.js");
const W = require("../../assets/workshop-core.js");

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

async function open({ width = 1280, height = 900, scheme = "light" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(site.url)) return route.continue();
    return route.fulfill({ status: 200, contentType: "text/css", body: "" });
  });
  await page.goto(site.url);
  await page.waitForSelector("#ws-preview:not(:empty)");
  return { page, context, errors };
}

const rewrite = (page) => page.$eval("#ws-preview", (el) => el.dataset.text);
const checkStatus = (page, id) => page.$eval(`[data-check="${id}"]`, (el) => el.className.match(/is-(\w+)/)[1]).catch(() => null);
const expected = (key) => {
  const ex = W.EXAMPLES[key];
  return W.assemble(W.suggest(W.parseDraft(ex.text), W.methodsFrom(ex.methods))).text;
};

test("the workshop opens on the deck example, already rewritten", async () => {
  const { page, context, errors } = await open();
  assert.equal(await page.inputValue("#ws-draft"), W.EXAMPLES.pyramid.text);
  assert.equal(await rewrite(page), expected("pyramid"));
  assert.ok((await rewrite(page)).startsWith("Hi Mark,\n\nWould it be possible to push it back?"));
  assert.equal(await page.locator("#ws-chips .ws-chip.is-filler").count(), 2);
  assert.equal(await checkStatus(page, "minto-specific"), "warn");
  assert.deepEqual(errors, []);
  await context.close();
});

test("every example loads, sets its method and matches the workshop's logic", async () => {
  const { page, context, errors } = await open();
  for (const [key, ex] of Object.entries(W.EXAMPLES)) {
    await page.click(`[data-example="${key}"]`);
    assert.equal(await page.inputValue("#ws-draft"), ex.text, key);
    assert.equal(await rewrite(page), expected(key), key);
    for (const m of W.METHODS) {
      assert.equal(await page.isChecked(`input[data-method="${m}"]`), ex.methods.includes(m), key + " " + m);
    }
    assert.equal(await page.getAttribute(`[data-example="${key}"]`, "aria-pressed"), "true");
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test("editing a slot updates the rewrite and its checks", async () => {
  const { page, context } = await open();
  await page.fill("#ws-point", "Could we move the deck start from 11/14 to 11/21?");
  await page.waitForFunction(() => document.getElementById("ws-preview").dataset.text.includes("11/21?"));
  assert.equal(await checkStatus(page, "minto-specific"), "pass");
  assert.ok((await rewrite(page)).startsWith("Hi Mark,\n\nCould we move the deck start from 11/14 to 11/21?"));
  await context.close();
});

test("clicking a sentence adds it to the slot you picked", async () => {
  const { page, context } = await open();
  await page.focus("#ws-close");
  assert.equal(await page.textContent("#ws-target"), "Next step");
  await page.click("#ws-chips .ws-chip >> text=Things have been a bit hectic");
  assert.equal(await page.inputValue("#ws-close"), "Things have been a bit hectic on our end lately.");
  assert.ok((await rewrite(page)).includes("Things have been a bit hectic on our end lately."));
  assert.ok(await page.$eval("#ws-chips .ws-chip >> nth=1", (b) => b.classList.contains("is-used")));
  await context.close();
});

test("the keyboard can add a sentence and move a line", async () => {
  const { page, context } = await open();
  await page.focus("#ws-support-0");
  await page.focus("#ws-chips .ws-chip >> nth=0");
  await page.keyboard.press("Enter");
  assert.equal(await page.inputValue("#ws-support-1"), "I hope you're doing well.");
  await page.focus('button[data-action="down"][data-index="0"]');
  await page.keyboard.press("Enter");
  assert.equal(await page.inputValue("#ws-support-1"), "Last week we talked about starting the deck on the 14th, and that could still work.");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.index), "1", "focus follows the moved line");
  await context.close();
});

test("SCQA adds its beats, and the order buttons reorder the opening", async () => {
  const { page, context } = await open();
  await page.check('input[data-method="scqa"]');
  assert.equal(await page.inputValue("#ws-complication"), "My in-laws are visiting that week and the yard will be pretty busy.");
  await page.fill("#ws-situation", "We planned to start the deck on 11/14.");
  await page.fill("#ws-point", "Could we move the deck start to 11/21?");
  await page.check('input[name="ws-order"][value="sca"]');
  await page.waitForFunction(() => document.getElementById("ws-preview").dataset.text.includes("Hi Mark,\n\nWe planned"));
  const text = await rewrite(page);
  assert.ok(text.indexOf("We planned") < text.indexOf("My in-laws") && text.indexOf("My in-laws") < text.indexOf("Could we move"), text);
  assert.equal(await page.textContent(".slot-point .slot-owner"), "SCQA");
  await context.close();
});

test("MECE builds groups, catches a duplicate, and clears when it's gone", async () => {
  const { page, context } = await open();
  await page.click('[data-example="mece"]');
  assert.equal(await checkStatus(page, "mece-overlap"), "warn");
  await page.fill("#ws-point", "Three jobs before Friday.");
  await page.fill("#ws-rule", "By person");
  await page.fill("#ws-glabel-0", "Ana");
  await page.fill("#ws-gitems-0", "Book the cabin");
  await page.click('button[data-action="add-group"]');
  assert.equal(await page.evaluate(() => document.activeElement.id), "ws-glabel-1");
  await page.fill("#ws-glabel-1", "Me");
  await page.fill("#ws-gitems-1", "The car, an oil check and new wipers");
  await page.waitForFunction(() => document.getElementById("ws-preview").dataset.text.includes("Me: the car"));
  assert.equal(await rewrite(page), "Three jobs before Friday.\n\nAna: book the cabin.\n\nMe: the car, an oil check and new wipers.");
  assert.equal(await checkStatus(page, "mece-overlap"), "pass");
  assert.equal(await checkStatus(page, "mece-count"), "pass");
  await context.close();
});

test("Writing Without Bullshit lists its cuts, scores the meaning ratio, and the cuts can be undone", async () => {
  const { page, context } = await open();
  await page.click('[data-example="wwb"]');
  assert.match(await page.textContent("#ws-cuts"), /^Trimmed 4 stock phrases/);
  const ratio = await page.textContent("#ws-score >> text=Meaning ratio");
  assert.ok(ratio);
  assert.ok(!(await rewrite(page)).includes("earliest convenience"));
  await page.uncheck("#ws-trim");
  await page.waitForFunction(() => document.getElementById("ws-preview").dataset.text.includes("earliest convenience"));
  assert.equal(await page.isHidden("#ws-cuts"), true);
  await page.check("#ws-is-email");
  await page.fill("#ws-subject", "Charged twice for invoice #4471");
  await page.waitForFunction(() => document.getElementById("ws-preview").dataset.text.startsWith("Subject: Charged twice"));
  await context.close();
});

test("Copy puts the rewrite on the clipboard", async () => {
  const { page, context } = await open();
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: site.url });
  await page.click("#ws-copy");
  await page.waitForFunction(() => document.getElementById("ws-copy").textContent === "Copied");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await rewrite(page));
  await context.close();
});

test("the rewrite opens in the scanner, and the scanner's text opens in the workshop", async () => {
  const { page, context } = await open();
  const text = await rewrite(page);
  await page.click("#ws-to-scanner");
  assert.equal(await page.inputValue("#scan-input"), text);
  await page.waitForFunction(() => document.getElementById("verdict").textContent.startsWith("No strong or moderate hits"));

  await page.click("#load-before");
  await page.click("#scan-to-workshop");
  const sample = await page.inputValue("#scan-input");
  assert.equal(await page.inputValue("#ws-draft"), sample);
  assert.equal(await page.inputValue("#ws-greeting"), "Hi Dana,");
  assert.equal(await page.inputValue("#ws-signoff"), "Best,\nSam");
  assert.ok(await page.locator("#ws-chips .ws-chip.is-filler").count() >= 2);
  await context.close();
});

test("each method's Try it button loads its draft into the workshop", async () => {
  const { page, context } = await open();
  for (const key of Object.keys(W.EXAMPLES)) {
    await page.click(`#tab-${key}`);
    await page.click(`[data-try="${key}"]`);
    assert.equal(await page.inputValue("#ws-draft"), W.EXAMPLES[key].text, key);
    assert.equal(await page.evaluate(() => document.activeElement.id), "ws-draft");
  }
  await page.waitForFunction(() => Math.abs(document.getElementById("workshop").getBoundingClientRect().top) < 120);
  await context.close();
});

test("Undo puts the slots back after a refill", async () => {
  const { page, context } = await open();
  await page.fill("#ws-point", "Could we move the deck start to 11/21?");
  await page.click("#ws-fill");
  assert.equal(await page.inputValue("#ws-point"), "Would it be possible to push it back?");
  await page.click("#ws-undo");
  assert.equal(await page.inputValue("#ws-point"), "Could we move the deck start to 11/21?");
  assert.equal(await page.isHidden("#ws-undo"), true);
  await context.close();
});

test("Clear empties the workshop, and a pasted draft fills it", async () => {
  const { page, context } = await open();
  await page.click('[data-example="clear"]');
  assert.equal(await page.inputValue("#ws-draft"), "");
  assert.equal(await rewrite(page), "");
  assert.equal(await page.locator("#ws-chips .ws-chip").count(), 0);
  await page.fill("#ws-draft", "Hey Jo,\n\nWe're moving to Denver on 3/22! Can you help us pack that Saturday?\n\nThanks,\nSam");
  await page.waitForFunction(() => document.getElementById("ws-preview").dataset.text.includes("Denver"));
  assert.equal(await page.inputValue("#ws-greeting"), "Hey Jo,");
  assert.equal(await page.inputValue("#ws-point"), "Can you help us pack that Saturday?");
  await context.close();
});

test("pasted text is shown as text, never run as HTML", async () => {
  const { page, context } = await open();
  await page.fill("#ws-draft", 'Hi <b>Jo</b>, <img src=x onerror="window.__pwned=1"> could you <script>window.__pwned=2</script> call me?');
  await page.click("#ws-fill");
  const found = await page.evaluate(() => ["#ws-chips", "#ws-preview", "#ws-checks"].map((s) => document.querySelector(s).querySelector("img, b, script")));
  assert.deepEqual(found, [null, null, null]);
  assert.ok((await rewrite(page)).includes("<img"));
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  await context.close();
});

test("on a phone the workshop stacks, fits, and keeps 16px text in its fields", async () => {
  for (const scheme of ["light", "dark"]) {
    const { page, context, errors } = await open({ width: 320, height: 700, scheme });
    await page.click('[data-example="mece"]');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${scheme}: page is ${overflow}px too wide`);
    const small = await page.$$eval("#ws textarea, #ws input:not([type]), #ws select", (els) =>
      els.filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16).map((el) => el.id));
    assert.deepEqual(small, []);
    assert.deepEqual(errors, []);
    await context.close();
  }
});
