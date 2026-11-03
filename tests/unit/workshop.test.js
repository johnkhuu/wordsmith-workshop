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
    wwb: ["minto-specific", "wwb-edit", "cover-test", "tells"],
    data: ["data-big-idea", "data-vague", "cover-test"],
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

test("checks are only those of the methods picked, plus the desks' own passes", () => {
  const st = state({ point: "We're moving to Denver on 3/22." });
  const methodsSeen = new Set(W.check(st, null).map((c) => c.method));
  assert.deepEqual([...methodsSeen].sort(), ["audit", "polish", "pyramid"]);
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

// ---------------------------------------------------------------------------
// The four steps: recommend, diagnose, tasks

test("methods are recommended by the skill's own rules", () => {
  const rec = (text) => W.recommend(W.parseDraft(text), text).map((r) => r.method);
  assert.deepEqual(rec(W.EXAMPLES.inverted.text), ["inverted"]);
  assert.deepEqual(rec(W.EXAMPLES.scqa.text), ["scqa"]);
  assert.deepEqual(rec(W.EXAMPLES.data.text), ["data"]);
  assert.deepEqual(rec(W.EXAMPLES.mece.text), ["mece", "wwb"]);
  assert.deepEqual(rec(W.EXAMPLES.wwb.text), ["wwb"]);
  assert.deepEqual(rec("Our November bill is $241, up from $96. Could you re-check it?"), ["data", "wwb"]);
  assert.deepEqual(rec("Happy birthday, Gran. We love you."), [], "a card gets Minto alone");
  for (const r of W.recommend(W.parseDraft(W.EXAMPLES.wwb.text), W.EXAMPLES.wwb.text)) assert.ok(r.why.length > 10);
});

test("the review flags a buried point, filler and tells, and says what's good", () => {
  const ex = W.EXAMPLES.pyramid;
  const parsed = W.parseDraft(ex.text);
  const d = W.diagnose(ex.text, parsed, W.methodsFrom([]));
  assert.deepEqual(d.flags.map((f) => f.id), ["buried", "filler", "vague", "tells", "voice"]);
  assert.equal(d.flags[0].title, "Your point is in sentence 4 of 4");
  assert.equal(parsed.pieces.find((p) => p.id === d.pointId).text, "Would it be possible to push it back?");
  const clean = "Could you pick up Ava at 3 today? I'm stuck at work until 5.";
  assert.deepEqual(W.diagnose(clean, W.parseDraft(clean), W.methodsFrom([])).flags.map((f) => f.id), ["clean"]);
});

test("the review adds each method's own flags", () => {
  const mece = W.diagnose(W.EXAMPLES.mece.text, W.parseDraft(W.EXAMPLES.mece.text), W.methodsFrom(["mece"]));
  assert.deepEqual(mece.flags.map((f) => f.id), ["no-point", "list", "repeat"]);
  const scqa = W.diagnose(W.EXAMPLES.scqa.text, W.parseDraft(W.EXAMPLES.scqa.text), W.methodsFrom(["scqa"]));
  assert.ok(scqa.flags.some((f) => f.id === "no-change"));
  const data = W.diagnose(W.EXAMPLES.data.text, W.parseDraft(W.EXAMPLES.data.text), W.methodsFrom(["data"]));
  assert.deepEqual(data.flags.find((f) => f.id === "vague-amount").quotes, ["a lot", "significant"]);
});

test("fix cards point at the exact line that needs the change", () => {
  const { st, parsed } = firstPass("wwb");
  const cards = W.tasks(st, parsed);
  assert.deepEqual(cards.map((c) => c.key), ["point", "support:0"]);
  assert.ok(cards[0].issues.some((i) => /vague word/.test(i.title)));
  assert.deepEqual(cards[1].issues.map((i) => i.quotes[0]), ["been charged"]);
  assert.equal(cards[1].value, st.support[0]);

  const mece = firstPass("mece");
  assert.deepEqual(W.tasks(mece.st, mece.parsed).map((c) => c.key), ["point", "groups"]);
  assert.deepEqual(W.tasks(firstPass("inverted").st, firstPass("inverted").parsed), [], "nothing left to fix");
});

test("a fix clears its card", () => {
  const { st, parsed } = firstPass("pyramid");
  assert.deepEqual(W.tasks(st, parsed).map((c) => c.key), ["point"]);
  W.setField(st, "point", 0, "Could we move the deck start from 11/14 to 11/21?");
  assert.deepEqual(W.tasks(st, parsed), []);
});

test("the rewrite knows which slot every stretch of it came from", () => {
  const { st } = firstPass("pyramid");
  const built = W.assemble(st);
  for (const p of built.parts) {
    const slice = built.text.slice(p.start, p.end);
    if (p.field === "point") assert.equal(slice, "Would it be possible to push it back?");
    if (p.field === "greeting") assert.equal(slice, "Hi Mark,");
  }
  assert.equal(W.partAt(built, built.text.indexOf("in-laws")).field, "support");
});

test("writing the trims into the slots keeps the text you edit the same as the text you see", () => {
  const { st } = firstPass("wwb");
  const before = W.assemble(st).text;
  const baked = W.bakeTrims(st);
  assert.equal(baked.state.trim, false);
  assert.equal(W.assemble(baked.state).text, before);
  assert.equal(baked.state.point, "I would appreciate it if this could be looked into.");
  assert.equal(baked.cuts.length, 4);
});

test("the finish line reports where the point moved", () => {
  const { ex, st, parsed } = firstPass("pyramid");
  const c = W.compare(ex.text, st, parsed);
  assert.equal(c.pointFrom, 4);
  assert.equal(c.pointTo, 1);
  assert.equal(c.filler, 2);
  const sca = W.compare(ex.text, Object.assign(W.switchMethod(st, parsed, "scqa", true), { order: "sca", situation: "We planned the 14th." }), parsed);
  assert.equal(sca.pointTo, 3, "with the situation first, the point is third");
});

// ---------------------------------------------------------------------------
// Regressions from the code review

test("a greeting word never swallows the message", () => {
  const a = W.parseDraft("Hey can you grab milk, we're out.");
  assert.equal(a.greeting, "");
  assert.deepEqual(a.pieces.map((p) => p.text), ["Hey can you grab milk, we're out."]);
  assert.equal(W.parseDraft("Hey can you call me").greeting, "");
  assert.equal(W.parseDraft("hi Mark, the gate code is 4471.").greeting, "hi Mark,", "a lowercase greeting is still a greeting");
});

test("trims only cut phrases that leave a whole sentence behind", () => {
  const t = (s, wwb) => W.applyTrims(s, wwb).text;
  assert.equal(t("I wanted to follow up on the dishwasher repair from last week."), "I wanted to follow up on the dishwasher repair from last week.");
  assert.equal(t("I hope you're doing well and that the move went smoothly."), "I hope you're doing well and that the move went smoothly.");
  assert.equal(t("Thank you very much for the flowers!", true), "Thank you very much for the flowers!");
  assert.equal(t("We're going to a Super Bowl party.", true), "We're going to a Super Bowl party.");
  assert.equal(t("It's not really a problem.", true), "It's not really a problem.");
  assert.equal(t("It was a really good trip.", true), "It was a good trip.");
  assert.equal(t("Thanks. In summary, we loved it."), "Thanks. We loved it.");
});

test("method toggles keep every line and every group name", () => {
  const parsed = W.parseDraft(W.EXAMPLES.pyramid.text);
  const on = W.switchMethod(W.suggest(parsed, W.methodsFrom([])), parsed, "scqa", true);
  const off = W.switchMethod(on, parsed, "scqa", false);
  assert.ok(W.assemble(off).text.includes("My in-laws are visiting that week"));

  const st = state({ support: ["Towels.", "Sunscreen"] });
  const mece = W.switchMethod(st, null, "mece", true);
  assert.deepEqual(mece.groups[0].items.split("\n"), ["Towels", "Sunscreen"]);
  mece.groups = [{ label: "Ana", items: "Book the cabin", mode: "auto" }];
  assert.deepEqual(W.switchMethod(mece, null, "mece", false).support, ["Ana: book the cabin."]);
});

test("names and days keep their capitals in a joined list", () => {
  const st = state({ point: "Plans.", rule: "By person", groups: [{ label: "Settled", items: "Dan drives\nMaya brings games\nSaturday dinner plans", mode: "sentence" }] }, ["mece"]);
  assert.match(W.assemble(st).body, /Settled: Dan drives, Maya brings games, and Saturday dinner plans\./);
});

test("a number only counts as compared when there's a real comparison", () => {
  const st = state({ point: "The repair costs $500 and I want to know if that's right." }, ["data"]);
  assert.ok(W.check(st, null).some((c) => c.id === "data-compare" && c.status === "warn"));
  const ok = state({ point: "The repair costs $500, up from the $350 quote." }, ["data"]);
  assert.ok(W.check(ok, null).some((c) => c.id === "data-compare" && c.status === "pass"));
});

test("sign-offs, footers and lowercase texts are read the way people write them", () => {
  assert.equal(W.parseDraft("Can you pick up Ava at 3 today?\n\nThanks!\n– Sam").signoff, "Thanks!\n– Sam");
  const jen = W.parseDraft("Hey Tom, can you pick up Ava at 3 today? Thanks, Jen");
  assert.deepEqual([jen.greeting, jen.signoff], ["Hey Tom,", "Thanks, Jen"]);
  const flowers = W.parseDraft("Thanks for the flowers!");
  assert.deepEqual([flowers.signoff, flowers.pieces.length], ["", 1]);
  assert.deepEqual(W.parseDraft("Dinner is at 7.\n\nSent from my iPhone").pieces.map((p) => p.text), ["Dinner is at 7."]);
  assert.deepEqual(W.parseDraft("can you grab milk? we're out. thanks").pieces.map((p) => p.text), ["Can you grab milk?", "We're out."]);
  assert.deepEqual(W.splitSentences("The answer is no. We can't make it."), ["The answer is no.", "We can't make it."]);
  assert.equal(W.assemble(state({ point: "See you at 6 😊" })).text, "See you at 6 😊");
});

test("the ask pattern stays fast on long runs of spaces", () => {
  const t0 = Date.now();
  W.describe("Can you?" + " ".repeat(30000) + "x");
  assert.ok(Date.now() - t0 < 200, (Date.now() - t0) + "ms");
});

// ---------------------------------------------------------------------------
// The editorial desk: copy, line, copywriter and fact-checking passes

const at = (text) => W.polish(text).map((f) => f.code + " " + f.desk + " " + f.match.trim());
W.polish.today = new Date(2026, 10, 2); // 2 Nov 2026, so the date checks don't drift

test("the copy editor catches doubled words, doubled punctuation and restated lines", () => {
  assert.deepEqual(at("Can the the plumber come Friday,, at 9?"), ["P1 copy the the", "P2 copy ,,"]);
  assert.deepEqual(at("The deck start is on the 14th. The deck start is on the 14th, right."), ["P3 copy The deck start is on the 14th, right."]);
  assert.deepEqual(at("We booked the cabin by the lake for Saturday. Later we booked the cabin by the lake again."), ["P4 copy booked the cabin by the lake"]);
  assert.deepEqual(at("I had had enough. That that was it."), [], "real doubles aren't flagged");
});

test("repeating the right word is fine; only restatements and samey openers are flagged", () => {
  assert.deepEqual(at("The deck needs stain. Mark can stain the deck Friday. The stain is in the garage."), []);
  assert.deepEqual(at("I called Monday. I left a note. I sent a text. Could you reply?").map((x) => x.split(" ").slice(0, 2).join(" ")), ["P5 line"]);
});

test("the copy editor wants one spelling and one style throughout", () => {
  assert.deepEqual(at("Dana will bring wine on Saturday. Then Dena will bring dessert."), ["K1 copy Dena"]);
  assert.deepEqual(at("Dana will bring wine. Dena will bring dessert."), ["K1 copy Dena"]);
  assert.deepEqual(at("Dana and Dena will both come."), [], "two names in one sentence are two people");
  assert.deepEqual(at("Dinner at 7pm, dessert at 8 p.m."), ["K2 copy 8 p.m."]);
  assert.deepEqual(at("The quote was $1,800 and the bill was $1950."), ["K3 copy $1950"]);
});

test("the line editor flags long sentences, wordy phrases, double negatives and stacked hedges", () => {
  assert.deepEqual(at("In order to help, it is not uncommon for us to call prior to the visit.").map((x) => x.split(" ")[0]), ["P7", "P8", "P7"]);
  const long = "We wanted to let you know that the plans for the weekend have changed because the cabin we booked had a pipe burst and the owner cannot fix it until the following Tuesday at the earliest.";
  assert.match(at(long)[0], /^P6 line/);
  assert.equal(at("I think it might be a bit late, maybe.").filter((x) => x.startsWith("T4")).length, 4);
  assert.deepEqual(at("I think it's late."), [], "one honest hedge is fine");
});

test("the copywriter flags shouting, extra exclamation points, harsh lines and announcing openers", () => {
  const codes = (t) => W.polish(t).map((f) => f.code);
  assert.deepEqual(codes("Quick question: can you send it?"), ["P9"]);
  assert.deepEqual(codes("We need this FIXED now."), ["T1"]);
  assert.deepEqual(codes("Great news!! We're moving!"), ["T1", "T2"]);
  assert.deepEqual(codes("Sorry, so sorry for the late notice."), ["T3"]);
  assert.deepEqual(codes("Per my last email, you need to refund it."), ["T6", "T5"]);
  assert.deepEqual(codes("Our RSVP and the HVAC quote are attached."), [], "acronyms aren't shouting");
});

test("the fact-checker checks every weekday against its date", () => {
  const facts = (t) => W.factCheck(t, new Date(2026, 10, 2)).map((f) => f.detail);
  assert.deepEqual(facts("Could you send it by Friday, 11/7?"), ["In 2026, 11/7 falls on a Saturday. Check which one you meant."]);
  assert.deepEqual(facts("Please refund it by Friday, 9/18."), []);
  assert.deepEqual(facts("Dinner is Saturday, November 14."), []);
  assert.deepEqual(facts("Dinner is Friday, November 14, 2026."), ["In 2026, 11/14 falls on a Saturday. Check which one you meant."]);
  assert.deepEqual(facts("See you 3/2 (Tuesday)."), [], "3/2/2027 is a Tuesday: an old date reads as next year's");
  assert.deepEqual(W.factCheck("Meet 2/30 (Monday).", new Date(2026, 10, 2)).map((f) => f.label), ["That date doesn't exist"]);
});

test("every desk has a lane, and the sign-off board reports each one", () => {
  assert.deepEqual(W.DESK_ORDER, ["structure", "line", "copy", "facts", "copywriter", "tells"]);
  const inv = firstPass("inverted");
  assert.ok(W.deskReport(inv.st, inv.parsed).every((d) => d.signed), "the inverted example passes every desk");
  const wwb = firstPass("wwb");
  const board = Object.fromEntries(W.deskReport(wwb.st, wwb.parsed).map((d) => [d.key, d.signed]));
  // No amount, date or name: the copywriter's cover test stays open until one goes in.
  assert.deepEqual(board, { structure: false, line: false, copy: true, facts: true, copywriter: false, tells: false });
});

test("fix cards and review flags say which desk raised them", () => {
  const { st, parsed } = firstPass("wwb");
  const cards = W.tasks(st, parsed);
  assert.deepEqual(cards.map((c) => c.desk), ["structure", "line"]);
  assert.deepEqual(cards[0].issues.map((i) => i.desk), ["structure", "copywriter", "line"]);
  const d = W.diagnose(W.EXAMPLES.pyramid.text, W.parseDraft(W.EXAMPLES.pyramid.text), W.methodsFrom([]));
  assert.deepEqual(d.flags.map((f) => f.desk), ["structure", "line", "structure", "tells", "copywriter"]);
  const draft = "Hi Sam,\n\nCould you come Friday, 11/7 at 7pm? Dana and Dena will be there at 8 p.m.\n\nThanks,\nJo";
  const flags = W.diagnose(draft, W.parseDraft(draft), W.methodsFrom([])).flags.map((f) => f.id + ":" + f.desk);
  assert.ok(flags.includes("facts:facts") && flags.includes("copy:copy"), flags.join(" "));
});

test("the cover test asks for a detail only this message could have", () => {
  const vague = state({ point: "Thank you so much for everything you have done for us over the past few months." });
  assert.ok(W.check(vague, null).some((c) => c.id === "cover-test" && c.status === "warn"));
  const specific = state({ point: "Thank you for watching Biscuit while we were away in Denver last week." });
  assert.ok(W.check(specific, null).some((c) => c.id === "cover-test" && c.status === "pass"));
});

test("the skill's own 'after' examples pass every desk", () => {
  const afters = [
    "Hi Mark,\n\nCould we move the deck start from 11/14 to 11/21? My in-laws are staying with us that week and the yard will be full.\n\nAnything from 11/21 through 11/30 works for us.\n\nThanks!",
    "Thanksgiving is usually at Mom's, but her kitchen won't be finished until January. So this year it's at our place, same time: 2pm on the 26th.",
    "We're moving to Milwaukee on March 15. We signed the lease Saturday: a two-bedroom ten minutes from Tara's new job. Visitors welcome from April.",
    "You charged my card twice for invoice #4471 ($185 on 9/12). Please refund the duplicate by Friday, 9/18.",
    "The new plan saves us $34 a month: $61 instead of $95. That's $408 a year, about one flight home.",
  ];
  for (const t of afters) assert.deepEqual(W.polishText(t).map((f) => f.code + " " + f.match), [], t);
});

test("a bare 'Quick question.' is filler, and one line's hedges make one note", () => {
  const t = "Quick question. I think it might be a bit late, maybe. Could you bring the dessert on 11/14?";
  const p = W.parseDraft(t);
  assert.equal(p.pieces[0].flags.filler, "Announces, says nothing");
  const st = W.bakeTrims(W.suggest(p, W.methodsFrom([]))).state;
  const hedges = W.tasks(st, p).flatMap((c) => c.issues).filter((i) => i.title === "Hedges pile up");
  assert.equal(hedges.length, 1);
  assert.deepEqual(hedges[0].quotes, ["I think", "might", "a bit", "maybe"]);
});

// ---------------------------------------------------------------------------
// Applying fixes

const fixed = (text, picks) => {
  const st = state({ point: text });
  let s = st;
  for (let i = 0; i < 6; i++) {
    const card = W.tasks(s, null).find((c) => c.field === "point");
    if (!card) break;
    const choose = {};
    card.issues.forEach((iss, k) => { if (iss.fix && iss.fix.choices) choose[k] = picks && picks[iss.title] !== undefined ? picks[iss.title] : 0; });
    const r = W.applyFixes(s, card, choose);
    if (!r.applied) break;
    s = r.state;
  }
  return s.point;
};

test("Apply makes the mechanical fixes itself", () => {
  assert.equal(fixed("Could you bring the the dessert,, in order to help?"), "Could you bring the dessert, to help?");
  assert.equal(fixed("Quick question: could you call prior to Friday?"), "Could you call before Friday?");
  assert.equal(fixed("Could you refund it ASAP? It isn't uncommon, and i will wait."), "Could you refund it soon? It is common, and I will wait.");
  assert.equal(fixed("Per my last email, could you send the $1950 refund we discussed for the $1,800 deposit?"), "Could you send the $1,950 refund we discussed for the $1,800 deposit?");
  assert.equal(fixed("We loved it!! Thanks for the dinner on 11/14!"), "We loved it. Thanks for the dinner on 11/14!");
});

test("choices apply the option the writer picks", () => {
  const facts = (pick) => fixed("Could you come by Friday, 11/7/2026?", { "The day doesn't match the date": pick });
  assert.equal(facts(0), "Could you come by Saturday, 11/7/2026?");
  assert.equal(facts(1), "Could you come by Friday, 11/6/2026?");
  const st = state({ point: "Dana will bring wine on 11/14.", support: ["Then Dena will bring dessert."] });
  const card = W.tasks(st, null).find((c) => c.issues.some((i) => i.title === "A name spelled two ways"));
  const k = card.issues.findIndex((i) => i.title === "A name spelled two ways");
  const r = W.applyFixes(st, card, { [k]: 0 });
  assert.equal(W.assemble(r.state).text, "Dana will bring wine on 11/14. Then Dana will bring dessert.");
});

test("a note that needs the writer's words has no automatic fix", () => {
  const { st, parsed } = firstPass("pyramid");
  const card = W.tasks(st, parsed)[0];
  assert.equal(W.autoFixes(card), 0);
  assert.equal(W.applyFixes(st, card).applied, 0);
});

test("restyling a time keeps the period that ended the sentence", () => {
  const t = "Could you come at 7pm? Dana arrives at 8 p.m. I think that works.";
  const f = W.polish(t).find((x) => x.code === "K2");
  assert.equal(W.applyPairs(t, f.fix.pairs), "Could you come at 7pm? Dana arrives at 8pm. I think that works.");
});

test("a word that starts a sentence isn't a name, so it can't pass the point or cover checks", () => {
  const vague = state({ point: "Would it be possible to push it back? Thanks." });
  assert.ok(W.check(vague, null).some((c) => c.id === "minto-specific" && c.status === "warn"));
  const named = state({ point: "Could you ask Mark to push it back?" });
  assert.ok(W.check(named, null).some((c) => c.id === "minto-specific" && c.status === "pass"));
});

// ---------------------------------------------------------------------
// Recommended edits for the notes that need the writer's words
// ---------------------------------------------------------------------

// The rewrite as the workshop shows it: the first pass with its trims made.
function baked(key) {
  const parsed = W.parseDraft(W.EXAMPLES[key].text);
  return { parsed, st: W.bakeTrims(W.suggest(parsed, W.methodsFrom(W.EXAMPLES[key].methods))).state };
}
const sugsFor = (st, parsed, code) => {
  const card = W.tasks(st, parsed).find((c) => c.issues.some((i) => i.code === code));
  assert.ok(card, "no card carries " + code);
  return { card, issue: card.issues.find((i) => i.code === code), texts: card.issues.find((i) => i.code === code).suggestions.map((x) => x.text) };
};
const lineSugs = (fields, code, methods) => sugsFor(state(fields, methods), null, code).texts;

test("lemma and active voice turn the common passives around", () => {
  assert.deepEqual(["charged", "looked", "stopped", "carried", "received", "paid", "sent"].map(W.lemma), ["charge", "look", "stop", "carry", "receive", "pay", "send"]);
  assert.deepEqual(["updated", "shared", "scheduled", "decided", "created", "called", "added", "visited", "opened", "canceled", "agreed", "handled"].map(W.lemma),
    ["update", "share", "schedule", "decide", "create", "call", "add", "visit", "open", "cancel", "agree", "handle"]);
  assert.equal(W.lemma("invoked"), null, "unsure, so no edit is built on a guess");
  assert.equal(W.activeVoice("I would appreciate it if this could be looked into."), "Could you look into this?");
  // A statement doesn't say who did it, so the doer is a blank, never a guessed "you".
  assert.equal(W.activeVoice("We moved out on 9/30 and the deposit has not been returned."), "We moved out on 9/30 and ___ didn't return the deposit.");
  assert.equal(W.activeVoice("It appears the invoice may have been charged twice."), "It appears ___ may have charged the invoice twice.");
  assert.equal(W.activeVoice("The package was delivered to the wrong house."), "___ delivered the package to the wrong house.");
  // When it does say, that's the subject.
  assert.equal(W.activeVoice("The deposit was paid by me in full on 10/3."), "I paid the deposit in full on 10/3.");
  assert.equal(W.activeVoice("The cabin was reserved by my sister on 9/2."), "My sister reserved the cabin on 9/2.");
  // A particle moves only when it belongs to the verb.
  assert.equal(W.activeVoice("Could the dog be walked at 5 on Friday?"), "Could you walk the dog at 5 on Friday?");
  assert.equal(W.activeVoice("Can the payment be made after the 15th?"), "Could you make the payment after the 15th?");
  assert.equal(W.activeVoice("Could the invoice be updated by Friday?"), "Could you update the invoice by Friday?");
  assert.equal(W.activeVoice("We had a great time."), null);
});

test("each example's open notes come with edits built from its own draft", () => {
  const pyramid = baked("pyramid");
  const point = sugsFor(pyramid.st, pyramid.parsed, "minto-specific").texts;
  assert.ok(point.includes("Could we push the deck back?"), point.join(" | "));
  assert.ok(point.includes("Could we push the deck from the 14th to ___?"), point.join(" | "));

  const wwb = baked("wwb");
  assert.ok(sugsFor(wwb.st, wwb.parsed, "minto-specific").texts.includes("Could you look into the invoice?"));
  const passive = W.tasks(wwb.st, wwb.parsed).find((c) => c.field === "support").issues.find((i) => i.code === "W1");
  assert.deepEqual(passive.suggestions.map((x) => x.text), ["Unfortunately, it appears ___ may have charged the invoice twice."]);

  const data = baked("data");
  const big = sugsFor(data.st, data.parsed, "data-big-idea").texts;
  assert.ok(big.includes("The new phone plan saves us $___ a month: $___ instead of $___."), big.join(" | "));

  const scqa = baked("scqa");
  assert.ok(sugsFor(scqa.st, scqa.parsed, "scqa-situation").texts.includes("Thanksgiving is usually ___."));
  assert.ok(sugsFor(scqa.st, scqa.parsed, "scqa-complication").texts.length >= 2);

  const mece = baked("mece");
  assert.equal(sugsFor(mece.st, mece.parsed, "mece-rule").texts[0], "Settled vs. still needed");
  assert.ok(sugsFor(mece.st, mece.parsed, "minto-point").texts.includes("Five things to sort out before ___."));
  assert.deepEqual(sugsFor(mece.st, mece.parsed, "mece-overlap").issue.suggestions.map((x) => x.kind), ["keep-item", "keep-item"]);
});

test("a blank marks the fact only the writer knows, and nothing else", () => {
  const { st, parsed } = baked("pyramid");
  const { issue } = sugsFor(st, parsed, "minto-specific");
  assert.deepEqual(issue.suggestions.map((x) => x.blank), [false, true]);
});

test("copy and tone notes get a rewritten line", () => {
  assert.deepEqual(lineSugs({ point: "Can you call me?", support: ["It's not about the money, it's about trust."] }, "C2"), ["It's about trust."]);
  assert.deepEqual(lineSugs({ point: "Can you call me?", support: ["Experts say carriers lose parcels."] }, "B2"),
    ["___ says carriers lose parcels.", "I think carriers lose parcels."]);
  assert.deepEqual(lineSugs({ point: "Can you call me?", support: ["This is unacceptable and I demand a refund."] }, "T5"),
    ["This is not what we agreed and I'd like a refund.", "This is a problem for us and I'm asking for a refund."]);
  assert.deepEqual(lineSugs({ point: "Can you call me?", support: ["Not sure if you saw my last email."] }, "T6"), ["Following up on my last email."]);
  assert.deepEqual(lineSugs({ point: "Can you call me?", support: ["I'm so sorry, sorry for the late reply."] }, "T3"), ["Sorry for the late reply."]);
  assert.deepEqual(lineSugs({ point: "Can you call me?", support: ["I called the depot.", "I left a note.", "I sent an email."] }, "P5"),
    ["Then I sent an email.", "After that, I sent an email."]);
});

test("every recommended edit clears its own note and adds no new tells", () => {
  const drafts = Object.values(W.EXAMPLES).map((e) => [e.methods, e.text]).concat([
    [["pyramid"], "Hi Dana, The package was delivered to the wrong house on Tuesday. It's not about the money, it's about trust. Experts say carriers lose a lot of parcels. I called the depot. I left a note. I sent an email. Could this be fixed by Friday? Thanks so much!"],
    [["pyramid"], "Hey, I'm so sorry, sorry for the late reply. This is unacceptable and I demand a refund for the jacket. The jacket was returned on 2/30. Let me know what you think. Thanks."],
    [["pyramid"], "Not sure if you saw my last email, but we still need the keys. The keys were supposed to be dropped off last week and that stands as a testament to how busy everyone is. Let me know if you have any questions."],
    [["pyramid", "inverted"], "So I was thinking about the party and the venue and the food, and also we should probably think about the music and maybe the date, and it would be great to sort everything out soon."],
    [["pyramid", "scqa"], "We need to decide on the vacation soon."],
    [["pyramid", "mece"], "Here's the plan. Sam is bringing chips. Jo is bringing drinks. We still need someone to bring ice. We still need plates."],
    [["pyramid", "data"], "Our water bill went up to $180 this month. That's a huge jump."],
  ]);
  let total = 0;
  for (const [methods, text] of drafts) {
    const parsed = W.parseDraft(text);
    const st = W.bakeTrims(W.suggest(parsed, W.methodsFrom(methods))).state;
    const tells = W.tellCount(W.assemble(st).text);
    for (const card of W.tasks(st, parsed)) {
      for (const issue of card.issues) {
        for (const sug of issue.suggestions || []) {
          total++;
          const filled = sug.kind === "line" ? Object.assign({}, sug, { text: W.sampleFill(sug.text) }) : sug;
          const out = W.applySuggestion(st, card, filled);
          const still = W.tasks(out, parsed).find((c) => c.key === card.key);
          const label = card.key + " " + issue.code + " → " + filled.text;
          assert.ok(!still || !still.issues.some((i) => i.code === issue.code), "still flagged: " + label);
          assert.ok(W.tellCount(W.assemble(out).text) <= tells, "new tells: " + label);
          assert.doesNotMatch(W.assemble(out).text, /___/, label);
        }
      }
    }
  }
  assert.ok(total >= 50, "only " + total + " edits checked");
});

test("structural edits split a point, sort the groups and keep one of two twins", () => {
  const long = state({ point: "So I was thinking about the party and the venue and the food, and also we should probably think about the music and maybe the date, and it would be great to sort everything out soon." }, ["inverted"]);
  const card = W.tasks(long, null).find((c) => c.field === "point");
  const split = card.issues.find((i) => i.code === "inv-lede").suggestions[0];
  assert.equal(split.kind, "split");
  const after = W.applySuggestion(long, card, split);
  assert.equal(after.point, "So I was thinking about the party and the venue and the food.");
  assert.match(after.support[0], /^We should probably think about the music/);

  const { st, parsed } = baked("mece");
  const original = JSON.stringify(st);
  const groups = W.tasks(st, parsed).find((c) => c.field === "groups");
  const sorted = W.applySuggestion(st, groups, { kind: "rule", text: "Settled vs. still needed" });
  assert.equal(sorted.rule, "Settled vs. still needed");
  assert.deepEqual(sorted.groups.map((g) => g.label), ["Settled", "Still needed"]);
  const keep = groups.issues.find((i) => i.code === "mece-overlap").suggestions[0];
  const kept = W.applySuggestion(sorted, groups, keep);
  const items = kept.groups.flatMap((g) => g.items.split("\n")).filter(Boolean);
  assert.ok(items.includes(keep.text.slice(6, -1)) && !items.includes(keep.drop));
  assert.equal(JSON.stringify(st), original, "the original state is untouched");
});

test("dates written two ways offer both styles, one click each", () => {
  const t = "Could we move the move-in from 11/14 to November 21? The truck is booked for Nov 21st.";
  const f = W.polish(t).find((x) => x.code === "K4");
  assert.deepEqual(f.fix.choices.map((c) => c.label), ["Use November 14 style", "Use 11/21 style"]);
  assert.equal(W.applyPairs(t, f.fix.choices[0].pairs), "Could we move the move-in from November 14 to November 21? The truck is booked for November 21.");
  assert.equal(W.applyPairs(t, f.fix.choices[1].pairs), "Could we move the move-in from 11/14 to 11/21? The truck is booked for 11/21.");
});

// Every case below came from an independent review of the suggested edits.
// An edit must keep the sentence whole and never guess a fact.
test("suggested edits keep the grammar whole", () => {
  const sug = (text, code, methods) => lineSugs({ point: "Can you call me tonight?", support: [text] }, code, methods);
  assert.deepEqual(sug("Would you serve as our officiant at the wedding on June 6?", "C3"), ["Would you be our officiant at the wedding on June 6?"]);
  assert.deepEqual(sug("Could you act as a reference for me?", "C3"), ["Could you be a reference for me?"]);
  assert.deepEqual(sug("I'm serving as treasurer this year.", "C3"), ["I'm treasurer this year."]);
  assert.deepEqual(sug("I demand that you refund the deposit.", "T5"), ["I'd ask that you refund the deposit.", "I'm asking that you refund the deposit."]);
  assert.deepEqual(sug("I demand to speak to a manager.", "T5"), ["I'd like to speak to a manager."]);
  assert.deepEqual(sug("The delay is completely unacceptable.", "T5"), ["The delay is not what we agreed.", "The delay is a problem for us."]);
  assert.deepEqual(sug("It is a testament to your meticulous knitting.", "C7"), ["It shows your careful knitting."]);
  assert.deepEqual(sug("I'm not sure if you saw my text from Monday.", "T6"), ["Following up on my text from Monday."]);
  assert.deepEqual(sug("Sorry, not sure if you saw my note about the gate.", "T6"), ["Sorry, following up on my note about the gate."]);
  assert.deepEqual(sug("That's not a gift, that's a loan until 12/1.", "C2"), ["That's a loan until 12/1."]);
  assert.deepEqual(sug("Honestly, it's not about the money, it's about trust.", "C2"), ["Honestly, it's about trust."]);
  assert.deepEqual(sug("We got the keys on Monday, meaning we can move in on 12/1, ensuring the kids start school on time.", "B1"),
    ["We got the keys on Monday, meaning we can move in on 12/1."]);
  assert.deepEqual(sug("It has been a few weeks since we wrote.", "W2", ["wwb"]), ["It has been ___ weeks since we wrote."]);
  const { parsed, st } = (() => { const p = W.parseDraft("Hi all, Dave is bringing the cooler. Dave is bringing ice. Dave is bringing chairs. Dave wants the big table. Can you confirm by Friday?"); return { parsed: p, st: W.bakeTrims(W.suggest(p, W.methodsFrom([]))).state }; })();
  assert.deepEqual(sugsFor(st, parsed, "P5").texts, ["Then Dave is bringing chairs.", "After that, Dave is bringing chairs."], "names keep their capital");
  // A list of things isn't split at a comma: there's no second clause.
  assert.deepEqual(sug("Can someone bring the folding chairs from the garage, the big blue cooler from the basement, the extra plates from my mom, the speaker from the den and the cake from the bakery on Elm?", "P6"), []);
});

test("suggested edits never guess a fact: a date, an amount, a status or what 'it' means", () => {
  const draftSugs = (text, methods, code) => {
    const p = W.parseDraft(text);
    return sugsFor(W.bakeTrims(W.suggest(p, W.methodsFrom(methods))).state, p, code).texts;
  };
  // Whole dates only, with the right word in front.
  assert.deepEqual(draftSugs("We're getting married! The ceremony is May 23 at the lake, and the party starts at 6pm. We'd love for you to come.", ["inverted"], "inv-when"),
    ["We're getting married on May 23!", "We're getting married on ___!"]);
  // The date must belong to the thing being moved.
  assert.deepEqual(draftSugs("Hi Sam, Would it be possible to push the closing back a week? The inspection found mold in the basement on 11/1.", ["wwb"], "minto-specific"),
    ["Could we push the closing back a week?"]);
  assert.deepEqual(draftSugs("Hi Dana, The baby shower is May 23 at our place. Could we push it back?", [], "minto-specific"),
    ["Could we push the baby shower back?", "Could we push the baby shower from May 23 to ___?"]);
  // "It" is the thing acted on, not the busiest noun; people are never "it".
  assert.deepEqual(draftSugs("Hi, I returned the jacket to the store last week. The store said the refund takes five days. Can you check on it?", [], "minto-specific"),
    ["Can you check on the jacket?", "Can you check on the jacket by ___?"]);
  assert.ok(draftSugs("Hi, the landlord called about the lease. Is it okay if I sign it?", [], "minto-specific").every((t) => !/landlord/.test(t)));
  // Amounts keep their comparison, and only money talk gets a dollar sign.
  const amount = (t) => sugsFor(state({ point: t }, ["data"]), null, "data-vague-amount").texts;
  assert.deepEqual(amount("The new plan is way cheaper than what we pay now."), ["The new plan is $___ cheaper than what we pay now.", "The new plan saves us $___ a month: $___ instead of $___."]);
  assert.deepEqual(amount("The data cap is much higher on the new plan."), ["The data cap is ___ higher on the new plan."]);
  assert.deepEqual(amount("The new routine saves a lot of time."), []);
  // MECE: no status the items don't state, no label the rule doesn't support, no label used twice.
  const move = W.parseDraft("For the move: we need to rent the truck. We need boxes. Someone should cancel the internet. We still need a sitter for Saturday.");
  const moveSt = W.bakeTrims(W.suggest(move, W.methodsFrom(["mece"]))).state;
  assert.deepEqual(sugsFor(moveSt, move, "mece-count").texts, []);
  const labels = (rule, groups) => sugsFor(state({ point: "Here's the plan for Saturday.", rule, groups }, ["mece"]), null, "mece-labels").issue.suggestions;
  assert.deepEqual(labels("By person", [{ label: "", items: "Ana is bringing chips\nAna is bringing salsa", mode: "auto" }, { label: "", items: "Plates\nIce", mode: "auto" }]).map((x) => x.text), ["Name them Ana"]);
  assert.deepEqual(labels("Settled vs. still needed", [{ label: "Still needed", items: "We still need plates\nWe need ice", mode: "auto" }, { label: "", items: "Ana is bringing chips\nJo has the drinks", mode: "auto" }]).map((x) => x.text), ["Name them Settled"]);
  // A day/month date isn't "fixed" into a different one.
  assert.deepEqual(lineSugs({ point: "Can you call me tonight?", support: ["Can we meet on Friday 13/11 at the park?"] }, "F1"), []);
});

test("dates written two ways leave fractions, scores and ratios alone", () => {
  for (const t of ["It needs 1/2 cup of sugar for the Dec 5 party.", "Dinner on Nov 14 was 10/10.", "We should meet 3/4 of the way, on Dec 5.", "Let's split the cabin 50/50 on March 3."]) {
    assert.ok(!W.polish(t).some((f) => f.code === "K4"), t);
  }
  const t = "The lease starts 11/14/2026 and the movers come on Nov 12.";
  const f = W.polish(t).find((x) => x.code === "K4");
  assert.equal(W.applyPairs(t, f.fix.choices[0].pairs), "The lease starts November 14, 2026 and the movers come on November 12.");
});
