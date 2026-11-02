// Browser tests for the workshop: paste, review, fix, send.

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
  await page.waitForSelector("#ws:not([hidden])");
  return { page, context, errors };
}

const stageShown = (page) => page.$eval("#ws", (el) => el.dataset.stage);
const rewrite = (page) => page.$eval("#ws-preview", (el) => el.dataset.text);
const active = (page) => page.evaluate(() => document.activeElement.id);
const expected = (key) => {
  const ex = W.EXAMPLES[key];
  return W.assemble(W.bakeTrims(W.suggest(W.parseDraft(ex.text), W.methodsFrom(ex.methods))).state).text;
};
async function toFix(page, key) {
  await page.click(`[data-example="${key}"]`);
  await page.click("#wz-rewrite");
  await page.waitForFunction(() => document.getElementById("ws").dataset.stage === "fix");
}

test("the workshop starts on Paste, with the later steps locked", async () => {
  const { page, context, errors } = await open();
  assert.equal(await stageShown(page), "paste");
  assert.deepEqual(await page.$$eval(".wz-step", (bs) => bs.map((b) => b.disabled)), [false, true, true, true]);
  assert.equal(await page.getAttribute('.wz-step[data-go="paste"]', "aria-current"), "step");
  await page.click("#wz-check");
  assert.equal(await page.textContent("#wz-paste-hint"), "Paste or type a draft first.");
  assert.equal(await active(page), "ws-draft");
  assert.deepEqual(errors, []);
  await context.close();
});

test("checking a pasted draft shows its sentences, the flags and the methods picked for it", async () => {
  const { page, context, errors } = await open();
  await page.fill("#ws-draft", "Hi Dana,\n\nI hope this message finds you well! Our November bill was $241, up from $96 in October. Could you re-check it?\n\nThanks,\nSam");
  await page.click("#wz-check");
  assert.equal(await stageShown(page), "review");
  assert.equal(await active(page), "wz-h-review");
  assert.deepEqual(await page.$$eval(".wz-step", (bs) => bs.map((b) => [b.disabled, b.classList.contains("is-done")])), [[false, true], [false, false], [true, false], [true, false]]);
  assert.equal(await page.locator(".wz-sent.is-point").count(), 1);
  assert.match(await page.textContent(".wz-sent.is-point"), /Could you re-check it\?/);
  assert.equal(await page.locator(".wz-sent.is-filler").count(), 1);
  assert.equal(await page.locator(".wz-sent.is-voice").count(), 2);
  const flags = await page.$$eval(".wz-flag-title", (els) => els.map((e) => e.textContent));
  assert.ok(flags.some((f) => /Your point is in sentence 3 of 3/.test(f)), flags.join(" | "));
  const picked = await page.$$eval(".wz-pick-row .wz-pick-name", (els) => els.map((e) => e.textContent));
  assert.deepEqual(picked, ["Pyramid Always on", "Writing Without Bullshit Picked for you", "Storytelling with Data Picked for you"]);
  assert.deepEqual(errors, []);
  await context.close();
});

test("every example goes from paste to a rewrite that matches the workshop's logic", async () => {
  const { page, context, errors } = await open();
  for (const [key, ex] of Object.entries(W.EXAMPLES)) {
    await page.click('.wz-step[data-go="paste"]');
    await page.click(`[data-example="${key}"]`);
    assert.equal(await page.inputValue("#ws-draft"), ex.text, key);
    for (const m of W.METHODS) assert.equal(await page.isChecked(`#wz-change input[data-method="${m}"]`), ex.methods.includes(m), key + " " + m);
    await page.click("#wz-rewrite");
    assert.equal(await rewrite(page), expected(key), key);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test("changing a method updates the picks and keeps your place", async () => {
  const { page, context } = await open();
  await page.click('[data-example="pyramid"]');
  await page.click("#wz-change summary");
  await page.check('#wz-change input[data-method="scqa"]');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.method), "scqa");
  const picked = await page.$$eval(".wz-pick-name", (els) => els.map((e) => e.textContent));
  assert.deepEqual(picked, ["Pyramid Always on", "SCQA"]);
  assert.equal(await page.$eval("#wz-change", (d) => d.open), true);
  await page.click("#wz-rewrite");
  assert.ok(await page.$("#ws-situation"), "the SCQA slots appear under Edit every part");
  await context.close();
});

test("a fix card edits the line, updates the rewrite live, and moves on when it's fixed", async () => {
  const { page, context, errors } = await open();
  await toFix(page, "pyramid");
  assert.equal(await page.textContent("#wz-progress-text"), "0 of 1 fixes done");
  assert.match(await page.textContent(".wz-task-head h4"), /Your point/);
  assert.equal(await page.inputValue("#wz-input"), "Would it be possible to push it back?");
  await page.fill("#wz-input", "");
  // Type it key by key: the card must keep saving after its issue clears mid-word.
  await page.type("#wz-input", "Could we move the deck start from 11/14 to 11/21?");
  assert.ok((await rewrite(page)).startsWith("Hi Mark,\n\nCould we move the deck start from 11/14 to 11/21?"));
  await page.click('[data-action="apply"]');
  assert.equal(await page.textContent("#wz-progress-text"), "1 of 1 fixes done");
  assert.match(await page.textContent(".wz-clear h4"), /All fixed/);
  await page.click('.wz-clear [data-action="finish"]');
  assert.equal(await stageShown(page), "send");
  const wins = await page.$$eval("#wz-wins li", (els) => els.map((e) => e.textContent));
  for (const w of ["Moved your point from sentence 4 to sentence 1", "Cut 2 filler lines", "Made 1 fix of your own", "Shaped with Pyramid"]) {
    assert.ok(wins.includes(w), w + " in " + wins.join(" | "));
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test("a fix that leaves something flagged says so, and Skip moves on", async () => {
  const { page, context } = await open();
  await toFix(page, "wwb");
  assert.equal(await page.textContent("#wz-progress-text"), "0 of 2 fixes done");
  await page.fill("#wz-input", "Could you refund the duplicate charge on invoice #4471? It should be looked at by Friday.");
  await page.click('[data-action="apply"]');
  assert.match(await page.textContent(".wz-task-note"), /^1 thing left on this one/);
  await page.click('[data-action="skip"]');
  assert.match(await page.textContent(".wz-task-head h4"), /Supporting line 1/);
  assert.match(await page.textContent("#wz-progress-text"), /1 of 2 fixes done/);
  assert.match(await page.textContent("#ws-cuts"), /^Trimmed 4 stock phrases/);
  await context.close();
});

test("MECE's groups card sorts the list, and the duplicate warning clears", async () => {
  const { page, context } = await open();
  await toFix(page, "mece");
  await page.fill("#wz-input", "Three jobs before Friday.");
  await page.click('[data-action="apply"]');
  assert.match(await page.textContent(".wz-task-head h4"), /Your groups/);
  await page.fill("#wz-rule", "By person");
  await page.fill("#wz-glabel-0", "Ana");
  await page.fill("#wz-gitems-0", "Book the cabin");
  await page.click('#wz-task [data-action="add-group"]');
  assert.equal(await active(page), "wz-glabel-1");
  await page.fill("#wz-glabel-1", "Me");
  await page.fill("#wz-gitems-1", "The car, an oil check and new wipers");
  await page.click('[data-action="apply"]');
  assert.match(await page.textContent(".wz-clear h4"), /All fixed/);
  assert.equal(await rewrite(page), "Three jobs before Friday.\n\nAna: book the cabin.\n\nMe: the car, an oil check and new wipers.");
  await context.close();
});

test("Edit every part keeps focus on the controls you use", async () => {
  const { page, context } = await open();
  await page.click('[data-example="scqa"]');
  await page.click("#wz-rewrite");
  await page.click("#wz-advanced summary");
  await page.focus("#ws-order-asc");
  await page.keyboard.press("ArrowRight");
  assert.equal(await active(page), "ws-order-sca");
  await page.keyboard.press("ArrowRight");
  assert.equal(await active(page), "ws-order-csa", "arrow keys keep working after a change");
  await page.fill("#ws-close", "See you at 2pm on the 26th.");
  await page.waitForFunction(() => document.getElementById("ws-preview").dataset.text.includes("See you at 2pm on the 26th."));

  await page.click('button[data-action="add-item"]');
  await page.fill("#ws-support-1", "Bring a side dish.");
  await page.fill("#ws-support-0", "Mom's kitchen won't be ready.");
  await page.click("#ws-up-1");
  assert.equal(await page.inputValue("#ws-support-0"), "Bring a side dish.");
  assert.equal(await active(page), "ws-support-0", "focus lands on the moved line, not a disabled button");
  await context.close();
});

test("the finished message copies, reports leftover tells, and the last checks can be ticked", async () => {
  const { page, context } = await open();
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: site.url });
  await toFix(page, "inverted");
  assert.match(await page.textContent(".wz-clear h4"), /Nothing to fix/);
  await page.click("#wz-finish");
  assert.equal(await active(page), "wz-h-send");
  assert.match(await page.textContent("#wz-final-note"), /^Every desk reads it clean/);
  await page.fill("#wz-final", (await page.inputValue("#wz-final")) + "\n\nIn summary, we can't wait.");
  await page.waitForFunction(() => /^The desk has \d+ notes?/.test(document.getElementById("wz-final-note").textContent));
  await page.click("#ws-copy");
  await page.waitForFunction(() => document.getElementById("ws-copy").textContent === "Copied");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await page.inputValue("#wz-final"));
  for (const box of await page.$$("#wz-asks input")) await box.check();
  assert.equal(await page.isVisible("#wz-all-set"), true);
  await context.close();
});

test("the message opens in the scanner, and the scanner's text opens in the workshop", async () => {
  const { page, context } = await open();
  await toFix(page, "inverted");
  await page.click("#wz-finish");
  const text = await page.inputValue("#wz-final");
  await page.click("#ws-to-scanner");
  assert.equal(await page.inputValue("#scan-input"), text);

  await page.click("#load-before");
  await page.click("#scan-to-workshop");
  assert.equal(await stageShown(page), "review");
  assert.equal(await page.inputValue("#ws-draft"), await page.inputValue("#scan-input"));
  assert.ok(await page.locator(".wz-sent.is-filler").count() >= 2);
  await context.close();
});

test("each method's Try it button opens its draft in the review step", async () => {
  const { page, context } = await open();
  for (const key of Object.keys(W.EXAMPLES)) {
    await page.click(`#tab-${key}`);
    await page.click(`[data-try="${key}"]`);
    assert.equal(await stageShown(page), "review", key);
    assert.equal(await page.inputValue("#ws-draft"), W.EXAMPLES[key].text, key);
    assert.equal(await active(page), "wz-h-review");
  }
  await page.waitForFunction(() => Math.abs(document.getElementById("workshop").getBoundingClientRect().top) < 120);
  await context.close();
});

test("editing the draft again locks the later steps until it's checked", async () => {
  const { page, context } = await open();
  await toFix(page, "pyramid");
  await page.click('.wz-step[data-go="paste"]');
  await page.fill("#ws-draft", "Can you water the plants on Saturday?");
  assert.deepEqual(await page.$$eval(".wz-step", (bs) => bs.map((b) => b.disabled)), [false, true, true, true]);
  await page.focus("#ws-draft");
  await page.keyboard.press("Control+Enter");
  assert.equal(await stageShown(page), "review");
  await page.click('.wz-step[data-go="paste"]');
  await page.click("#wz-check");
  await page.click("#wz-rewrite");
  await page.click("#wz-finish");
  await page.click("#wz-again");
  assert.equal(await stageShown(page), "paste");
  assert.equal(await page.inputValue("#ws-draft"), "");
  assert.equal(await active(page), "ws-draft");
  await context.close();
});

test("pasted text is shown as text, never run as HTML", async () => {
  const { page, context } = await open();
  await page.fill("#ws-draft", 'Hi <b>Jo</b>, <img src=x onerror="window.__pwned=1"> could you <script>window.__pwned=2</script> call me?');
  await page.click("#wz-check");
  await page.click("#wz-rewrite");
  const found = await page.evaluate(() => ["#wz-sentences", "#wz-flags", "#ws-preview", "#wz-task"].map((s) => document.querySelector(s).querySelector("img, b, script")));
  assert.deepEqual(found, [null, null, null, null]);
  assert.ok((await rewrite(page)).includes("<img"));
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  await context.close();
});

test("on a phone every step fits, in both themes, with 16px text in its fields", async () => {
  for (const scheme of ["light", "dark"]) {
    const { page, context, errors } = await open({ width: 320, height: 700, scheme });
    await page.click('[data-example="mece"]');
    await page.click("#wz-rewrite");
    await page.click("#wz-advanced summary");
    for (const s of ["fix", "review", "paste"]) {
      await page.click(`.wz-step[data-go="${s}"]`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `${scheme} ${s}: page is ${overflow}px too wide`);
    }
    const small = await page.$$eval("#ws textarea, #ws input:not([type]), #ws input[list]", (els) =>
      els.filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16).map((el) => el.id));
    assert.deepEqual(small, []);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("the desk signs every note, from review to sign-off", async () => {
  const { page, context, errors } = await open();
  await page.fill("#ws-draft", "Hi Sam,\n\nCould you come by Friday, 11/7/2026 at 7pm? Dana and Dena will be there at 8 p.m. I think it might be a bit late, maybe.\n\nThanks,\nJo");
  await page.click("#wz-check");
  const notes = await page.$$eval(".wz-flag", (els) => els.map((e) => e.querySelector(".wz-flag-desk").textContent + ": " + e.querySelector(".wz-flag-title").textContent.replace(/^(To fix|Looks good): /, "")));
  assert.ok(notes.includes("Fact-checker: A date doesn't check out"), notes.join(" | "));
  assert.ok(notes.some((n) => /^Copy editor: (One copy fix|\d+ copy fixes)$/.test(n)), notes.join(" | "));
  assert.ok(notes.some((n) => n.startsWith("Line editor: ")), notes.join(" | "));

  await page.click("#wz-rewrite");
  const from = await page.$$eval("#wz-task .wz-task-from", (els) => els.map((e) => e.textContent));
  assert.match(from[0], /^[A-Z]{2}Note from the (Structural editor|Line editor|Copy editor|Fact-checker|Copywriter|Tell auditor)$/);
  // Skip every card, then the board shows which desks still have notes open.
  for (let i = 0; i < 8; i++) { const s = await page.$('#wz-task [data-action="skip"]'); if (!s) break; await s.click(); }
  await page.click("#wz-finish");
  const board = await page.$$eval(".wz-desk-row", (els) => els.map((e) => [e.querySelector(".wz-desk-name").textContent, e.classList.contains("is-signed")]));
  assert.deepEqual(board.map((b) => b[0]), ["Structural editor", "Line editor", "Copy editor", "Fact-checker", "Copywriter", "Tell auditor"]);
  assert.equal(board.find((b) => b[0] === "Fact-checker")[1], false, "the date is still wrong");
  assert.match(await page.textContent("#wz-board-title"), /desks? ha(s|ve) notes open/);
  assert.match(await page.textContent("#wz-final-note"), /Fact-checker, the day doesn't match the date/);
  assert.deepEqual(errors, []);
  await context.close();
});

test("a clean rewrite gets every desk's sign-off", async () => {
  const { page, context } = await open();
  await toFix(page, "pyramid");
  await page.fill("#wz-input", "Could we move the deck start from 11/14 to 11/21?");
  await page.click('[data-action="apply"]');
  await page.click("#wz-finish");
  assert.equal(await page.textContent("#wz-board-title"), "Every desk signed off");
  assert.equal(await page.locator(".wz-desk-row.is-signed").count(), 6);
  await context.close();
});

test("Apply fix makes the change itself, without any typing", async () => {
  const { page, context, errors } = await open();
  await page.fill("#ws-draft", "Hi Sam,\n\nCould you bring the the dessert on 11/14,, in order to help?\n\nThanks,\nJo");
  await page.click("#wz-check");
  await page.click("#wz-rewrite");
  assert.equal(await page.textContent('#wz-task [data-action="apply"]'), "Apply 3 fixes");
  const previews = await page.$$eval(".wz-fix-preview", (els) => els.map((e) => e.textContent));
  // Screen readers hear "becomes" in place of the arrow.
  assert.ok(previews.some((p) => /^Fix: the the\s*→\s*(becomes\s*)?the$/.test(p)), previews.join(" | "));
  await page.click('#wz-task [data-action="apply"]');
  assert.equal(await rewrite(page), "Hi Sam,\n\nCould you bring the dessert on 11/14, to help?\n\nThanks,\nJo");
  assert.match(await page.textContent(".wz-clear h4"), /All fixed/);
  assert.equal(await page.textContent("#wz-progress-text"), "1 of 1 fixes done");
  assert.deepEqual(errors, []);
  await context.close();
});

test("a choice applies with one click", async () => {
  const { page, context } = await open();
  await page.fill("#ws-draft", "Could you come by Friday, 11/7/2026 to fix the gate?");
  await page.click("#wz-check");
  await page.click("#wz-rewrite");
  const choices = await page.$$eval(".wz-choice", (els) => els.map((e) => e.textContent));
  assert.deepEqual(choices, ["Make it Saturday", "Keep Friday, move the date to 11/6"]);
  await page.click(".wz-choice >> nth=1");
  assert.equal(await rewrite(page), "Could you come by Friday, 11/6/2026 to fix the gate?");
  await context.close();
});

test("a note that needs your words waits for an edit before saving", async () => {
  const { page, context } = await open();
  await toFix(page, "pyramid");
  const button = '#wz-task [data-action="apply"]';
  assert.equal(await page.textContent(button), "Save my edit");
  assert.equal(await page.isDisabled(button), true);
  assert.equal(await page.textContent(".wz-needs"), "Needs your words");
  await page.fill("#wz-input", "Could we move the deck start from 11/14 to 11/21?");
  assert.equal(await page.isDisabled(button), false);
  await page.click(button);
  assert.match(await page.textContent(".wz-clear h4"), /All fixed/);
  await context.close();
});
