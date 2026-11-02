// Unit tests for the workshop's logic: reading a draft, the first pass,
// assembling the rewrite and each method's checks.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const W = require("../../assets/workshop-core.js");

const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");

function state(fields, methods) {
  const st = W.emptyState();
  st.methods = W.methodsFrom(methods || []);
  return Object.assign(st, fields);
}
const warnings = (st, parsed) => W.check(st, parsed).filter((c) => c.status === "warn").map((c) => c.id);
const ids = (st, parsed) => W.check(st, parsed).map((c) => c.id);
function firstPass(key) {
  const ex = W.EXAMPLES[key];
  const parsed = W.parseDraft(ex.text);
  const st = W.suggest(parsed, W.methodsFrom(ex.methods));
  return { ex, parsed, st, out: W.assemble(st) };
}

// ---------------------------------------------------------------------------
// Reading a draft

test("sentences split at their ends, not at abbreviations, decimals or dates", () => {
  assert.deepEqual(W.splitSentences("Dr. Lee paid $1,800.50 on 9/30. It cleared! Did it? Yes."),
    ["Dr. Lee paid $1,800.50 on 9/30.", "It cleared!", "Did it?", "Yes."]);
  assert.deepEqual(W.splitSentences("Meet at 2 p.m. at the park. Bring snacks"), ["Meet at 2 p.m. at the park.", "Bring snacks"]);
});

test("a long sentence splits where its second job starts", () => {
  assert.deepEqual(W.splitClauses("Last week we talked about starting the deck on the 14th, but my in-laws are visiting that week and the yard will be busy."),
    ["Last week we talked about starting the deck on the 14th.", "My in-laws are visiting that week and the yard will be busy."]);
  assert.deepEqual(W.splitClauses("Short, but fine."), ["Short, but fine."]);
});

test("greetings, sign-offs and subject lines come off the draft", () => {
  const a = W.parseDraft("Subject: Deck\n\nHi Mark,\n\nCould we move it?\n\nBest,\nSam");
  assert.equal(a.subject, "Deck");
  assert.equal(a.greeting, "Hi Mark,");
  assert.equal(a.signoff, "Best,\nSam");
  assert.deepEqual(a.pieces.map((p) => p.text), ["Could we move it?"]);

  const b = W.parseDraft("Hi Mom and Dad, we're staying home this year. Thanks!");
  assert.equal(b.greeting, "Hi Mom and Dad,");
  assert.equal(b.signoff, "Thanks!");
  assert.deepEqual(b.pieces.map((p) => p.text), ["We're staying home this year."]);

  const c = W.parseDraft("Still need:\n1. Towels\n- A cooler");
  assert.deepEqual(c.pieces.map((p) => p.text), ["Still need:", "Towels.", "A cooler."]);
});

test("stock openers and moods are filler; a stock opener carrying a fact is not", () => {
  const p = W.parseDraft("I hope you're doing well. Things have been hectic lately. I wanted to reach out because the invoice was charged twice on 9/12.");
  assert.deepEqual(p.pieces.map((x) => x.flags.filler), ["Stock opener", "Mood, not a fact", null]);
});

test("'may' and 'you know' don't fake a date or a shared situation", () => {
  const f = W.describe("I just wanted to let you know the invoice may have been charged twice.");
  assert.equal(f.date, false);
  assert.equal(f.situation, false);
});

test("the examples match the 'before' drafts in the Methods section", () => {
  for (const [key, ex] of Object.entries(W.EXAMPLES)) {
    const panel = html.split(`id="panel-${key}"`)[1];
    assert.ok(panel, key);
    const before = panel.split('<p class="example-before">')[1].split("</p>")[0]
      .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    assert.equal(ex.text, before, key);
  }
});

// ---------------------------------------------------------------------------
// The first pass

test("the first pass leads with the ask, the news or the decision", () => {
  const expected = {
    pyramid: "Would it be possible to push it back?",
    scqa: "After talking it through we've decided we'll do Thanksgiving at our place this year.",
    mece: "",
    inverted: "We're moving to Milwaukee in March!",
    wwb: "I would really appreciate it if this could possibly be looked into at your earliest convenience.",
    data: "The new phone plan is a lot cheaper and would save us a significant amount over the year compared to what we're paying now.",
  };
  for (const key of Object.keys(W.EXAMPLES)) assert.equal(firstPass(key).st.point, expected[key], key);
});

test("the first pass leaves filler out and keeps the greeting", () => {
  const { out, st } = firstPass("pyramid");
  assert.equal(st.greeting, "Hi Mark,");
  assert.ok(out.text.startsWith("Hi Mark,\n\nWould it be possible to push it back?"), out.text);
  assert.ok(!/hope you're doing well|hectic/.test(out.text), out.text);
});

test("Inverted Pyramid sends backstory to the bottom", () => {
  const { st, out } = firstPass("inverted");
  assert.match(st.background, /^After looking at a bunch of places/);
  assert.ok(out.text.startsWith("We're moving to Milwaukee in March!"));
  assert.ok(out.text.endsWith("we finally signed a lease."));
});

test("MECE splits a run-on list into one item per job", () => {
  const { st } = firstPass("mece");
  const items = st.groups.flatMap((g) => g.items.split("\n"));
  assert.deepEqual(items, ["For the trip we still need to book the cabin", "Someone should check the car", "We need groceries",
    "Has anyone booked the cabin yet?", "Snacks for the drive", "The car needs new wipers"]);
});

test("the Writing Without Bullshit pass cuts the stock phrases and lists every cut", () => {
  const { out } = firstPass("wwb");
  assert.equal(out.text, "I would appreciate it if this could be looked into. Unfortunately, it appears the invoice may have been charged twice.");
  assert.deepEqual(out.cuts.map((c) => c.why).sort(), ["hedge", "intensifier", "stock opener", "stock phrase"]);
});

// ---------------------------------------------------------------------------
// Assembly

test("SCQA puts the three beats in the order you pick", () => {
  const base = { situation: "Thanksgiving is usually at Mom's", complication: "Her kitchen won't be finished until January", point: "This year it's at our place" };
  const order = (o, extra) => W.assemble(state(Object.assign({}, base, { order: o }), ["scqa"].concat(extra || []))).body;
  assert.equal(order("asc"), "This year it's at our place. Thanksgiving is usually at Mom's. Her kitchen won't be finished until January.");
  assert.equal(order("sca"), "Thanksgiving is usually at Mom's. Her kitchen won't be finished until January. This year it's at our place.");
  assert.equal(order("csa"), "Her kitchen won't be finished until January. Thanksgiving is usually at Mom's. This year it's at our place.");
  assert.ok(order("sca", ["inverted"]).startsWith("This year it's at our place."), "the lede takes the first sentence");
});

test("MECE groups read as sentences or numbered lists, and names keep their capitals", () => {
  const st = state({
    point: "Cabin weekend update: check-in is Friday at 4",
    rule: "Settled vs. still needed",
    groups: [
      { label: "Settled", items: "Dan is driving\nMaya is bringing games\nThe cabin has sheets", mode: "sentence" },
      { label: "Still need a volunteer for", items: "Groceries\nTowels", mode: "list" },
    ],
  }, ["mece"]);
  assert.equal(W.assemble(st).body,
    "Cabin weekend update: check-in is Friday at 4.\n\nSettled: Dan is driving, Maya is bringing games, and the cabin has sheets.\n\nStill need a volunteer for:\n1. Groceries.\n2. Towels.");
});

test("the subject line shows only for an email with Writing Without Bullshit on", () => {
  const st = state({ subject: "Refund for invoice #4471", point: "Please refund the duplicate by Friday, 9/18.", isEmail: true }, ["wwb"]);
  assert.ok(W.assemble(st).text.startsWith("Subject: Refund for invoice #4471\n\n"));
  st.isEmail = false;
  assert.ok(!W.assemble(st).text.includes("Subject:"));
});

test("turning the trims off keeps the text as written", () => {
  const st = state({ point: "I would really appreciate a refund at your earliest convenience." }, ["wwb"]);
  assert.equal(W.assemble(st).text, "I would appreciate a refund.");
  st.trim = false;
  assert.equal(W.assemble(st).text, "I would really appreciate a refund at your earliest convenience.");
});

test("switching methods moves content instead of losing it", () => {
  const parsed = W.parseDraft(W.EXAMPLES.pyramid.text);
  let st = W.suggest(parsed, W.methodsFrom([]));
  const before = W.assemble(st).body;
  st = W.switchMethod(st, parsed, "mece", true);
  st = W.switchMethod(st, parsed, "mece", false);
  assert.equal(W.assemble(st).body.replace(/\s+/g, " "), before.replace(/\s+/g, " "));

  const sc = W.switchMethod(W.suggest(parsed, W.methodsFrom([])), parsed, "scqa", true);
  assert.equal(sc.complication, "My in-laws are visiting that week and the yard will be pretty busy.");

  const inv = W.suggest(W.parseDraft(W.EXAMPLES.inverted.text), W.methodsFrom(["inverted"]));
  const off = W.switchMethod(inv, null, "inverted", false);
  assert.equal(off.background, "");
  assert.ok(off.support.some((s) => s.startsWith("After looking")));
});

// ---------------------------------------------------------------------------
// Checks

test("each method's 'after' example passes that method's checks", () => {
  const afters = {
    pyramid: state({ greeting: "Hi Mark,", point: "Could we move the deck start from 11/14 to 11/21?",
      support: ["My in-laws are staying with us that week and the yard will be full."],
      close: "Anything from 11/21 through 11/30 works for us.", signoff: "Thanks!" }),
    scqa: state({ situation: "Thanksgiving is usually at Mom's,", complication: "but her kitchen won't be finished until January.",
      point: "So this year it's at our place, same time: 2pm on the 26th.", order: "sca", support: [""] }, ["scqa"]),
    mece: state({ point: "Three jobs before Friday.", rule: "By person", groups: [
      { label: "Ana", items: "Book the cabin", mode: "sentence" },
      { label: "Me", items: "The car, an oil check and new wipers", mode: "sentence" },
      { label: "Raj", items: "Food, groceries and snacks for the drive", mode: "sentence" }] }, ["mece"]),
    inverted: state({ point: "We're moving to Milwaukee on March 15.",
      support: ["We signed the lease Saturday: a two-bedroom ten minutes from Tara's new job.", "Visitors welcome from April."] }, ["inverted"]),
    wwb: state({ point: "Please refund the duplicate by Friday, 9/18.",
      support: ["You charged my card twice for invoice #4471 ($185 on 9/12)."] }, ["wwb"]),
    data: state({ point: "The new plan saves us $34 a month: $61 instead of $95.",
      support: ["That's $408 a year, about one flight home."] }, ["data"]),
  };
  for (const [key, st] of Object.entries(afters)) {
    assert.deepEqual(warnings(st, null), [], key + ": " + W.assemble(st).text);
  }
});

test("each 'before' example gets the coaching its method is for", () => {
  const expected = {
    pyramid: ["minto-specific"],
    scqa: ["scqa-situation", "scqa-complication"],
    mece: ["minto-point", "mece-rule", "mece-count", "mece-overlap"],
    wwb: ["minto-specific", "wwb-edit", "tells"],
    data: ["data-big-idea", "data-vague"],
  };
  for (const [key, want] of Object.entries(expected)) {
    const { st, parsed } = firstPass(key);
    assert.deepEqual(warnings(st, parsed), want, key);
  }
  const inv = firstPass("inverted");
  assert.deepEqual(warnings(inv.st, inv.parsed), [], "the first pass already fixes the buried lede");
});

test("the draft's leftovers are reported, filler and all", () => {
  const { st, parsed } = firstPass("pyramid");
  const filler = W.check(st, parsed).find((c) => c.id === "draft-filler");
  assert.deepEqual(filler.quotes, ["I hope you're doing well.", "Things have been a bit hectic on our end lately."]);
  st.support = [""];
  const unused = W.check(st, parsed).find((c) => c.id === "draft-unused");
  assert.equal(unused.quotes.length, 2);
});

test("an ending that recaps gets flagged", () => {
  const st = state({ point: "Could we move the deck start to 11/21?", close: "In summary, could we move the deck start to 11/21?" });
  st.trim = false;
  assert.ok(warnings(st, null).includes("minto-close"));
});

test("numbers without a comparison, and precise figures, are flagged", () => {
  const st = state({ point: "Could you re-check our November bill of $241.16?", support: ["It is due on 12/1."] }, ["data"]);
  const all = W.check(st, null);
  assert.ok(all.some((c) => c.id === "data-compare" && c.status === "warn"));
  assert.ok(all.some((c) => c.id === "data-round"));
});

test("checks are only those of the methods picked", () => {
  const st = state({ point: "We're moving to Denver on 3/22." });
  const methodsSeen = new Set(W.check(st, null).map((c) => c.method));
  assert.deepEqual([...methodsSeen].sort(), ["audit", "pyramid"]);
  assert.ok(!ids(st, null).some((id) => /^(scqa|mece|inv|wwb|data)-/.test(id)));
});

test("the meaning ratio rises when the padding goes", () => {
  const { ex, st, parsed } = firstPass("wwb");
  const c = W.compare(ex.text, st, parsed);
  assert.ok(c.ratio[0] < 80 && c.ratio[1] > c.ratio[0], JSON.stringify(c.ratio));
  assert.equal(W.meaningRatio(""), null);
  assert.equal(W.meaningRatio("Hi Dana,\n\nThanks for watching Biscuit.\n\nBest,\nSam"), 100);
});

test("the scoreboard knows where the point came from", () => {
  const { ex, st, parsed } = firstPass("pyramid");
  assert.equal(W.compare(ex.text, st, parsed).pointFrom, 4);
});

test("every slot's label and hint changes with the method that owns it", () => {
  assert.equal(W.slotCopy(W.methodsFrom([])).point.label, "Your point");
  assert.equal(W.slotCopy(W.methodsFrom(["scqa"])).point.label, "Answer");
  assert.equal(W.slotCopy(W.methodsFrom(["inverted", "scqa"])).point.label, "Lede");
  assert.equal(W.slotCopy(W.methodsFrom(["data"])).point.label, "Big Idea");
  assert.match(W.slotCopy(W.methodsFrom(["data", "scqa"])).point.hint, /key number/);
});
