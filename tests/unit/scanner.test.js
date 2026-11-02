// Unit tests for assets/scanner.js.
//
// The parity tests compare the JS scanner with the output of the skill's
// Python scanner (scripts/tell_scan.py), saved next to each fixture as
// <name>.expected.json and <name>.expected-wwb.json. Python is the source of
// truth: if the skill's script changes, regenerate those files (see
// CONTRIBUTING.md) and make the JS match.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { scan } = require("../../assets/scanner.js");

const FIXTURES = path.join(__dirname, "..", "fixtures");
const fixtureNames = fs.readdirSync(FIXTURES)
  .filter((f) => /\.(txt|md)$/.test(f))
  .sort();

function read(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

// The JS scanner adds offsets for highlighting; Python doesn't have them.
function withoutOffsets(result) {
  const copy = JSON.parse(JSON.stringify(result));
  for (const f of copy.findings) {
    delete f.start;
    delete f.end;
    delete f.spans;
  }
  return copy;
}

const ALL_CODES = ("A1 A2 A3 A4 B1 B2 B3 B4 B5 C1 C2 C2x C2r C3 C5 C5p C6 C7 C8 " +
  "D1 D2 D3 D4 D5 D5m D6 D6m D7 H1 R1 W1 W2 W3 W4 W5 X1").split(" ");

test("fixtures exist", () => {
  assert.ok(fixtureNames.length >= 5, "expected at least five fixtures");
});

for (const name of fixtureNames) {
  const base = name.replace(/\.(txt|md)$/, "");
  for (const wwb of [false, true]) {
    const expectedFile = base + (wwb ? ".expected-wwb.json" : ".expected.json");
    test(`matches tell_scan.py: ${name}${wwb ? " --wwb" : ""}`, () => {
      const expected = JSON.parse(read(expectedFile));
      const actual = withoutOffsets(scan(read(name), { wwb }));
      assert.deepEqual(actual, expected);
    });
  }
}

// Small texts that sit just either side of each numeric threshold, so a
// changed threshold or a rounding difference can't slip through.
const boundaryCases = JSON.parse(read("boundaries.json"));
const boundaryExpected = JSON.parse(read("boundaries.expected.json"));

test("every boundary case has an expected result", () => {
  assert.deepEqual(boundaryCases.map((c) => c.name).sort(), Object.keys(boundaryExpected).sort());
});

for (const c of boundaryCases) {
  test(`matches tell_scan.py at the boundary: ${c.name}`, () => {
    assert.deepEqual(withoutOffsets(scan(c.text, { wwb: c.wwb })), boundaryExpected[c.name]);
  });
}

test("the fixtures exercise every check the scanner has", () => {
  const seen = new Set();
  for (const name of fixtureNames) {
    for (const f of scan(read(name), { wwb: true }).findings) seen.add(f.code);
  }
  const missing = ALL_CODES.filter((c) => !seen.has(c));
  assert.deepEqual(missing, [], "add a fixture that triggers: " + missing.join(", "));
});

test("offsets point at the flagged text", () => {
  for (const name of fixtureNames) {
    const text = read(name);
    for (const f of scan(text, { wwb: true }).findings) {
      if (typeof f.start !== "number") continue;
      assert.ok(f.end > f.start, `${name} ${f.code}: empty span`);
      const slice = text.slice(f.start, f.end);
      assert.ok(slice.includes(f.match), `${name} ${f.code}: "${slice}" should contain "${f.match}"`);
    }
  }
});

test("vocabulary spans cover the flagged words", () => {
  const text = "We delve into the tapestry of a vibrant, robust plan.";
  const c7 = scan(text).findings.find((f) => f.code === "C7");
  assert.ok(c7, "expected an AI vocabulary finding");
  const words = c7.spans.map((s) => text.slice(s.start, s.end).toLowerCase()).sort();
  assert.deepEqual(words, ["delve", "robust", "tapestry", "vibrant"]);
});

test("findings come back strongest first", () => {
  const order = { strong: 0, moderate: 1, weak: 2 };
  for (const name of fixtureNames) {
    const sev = scan(read(name), { wwb: true }).findings.map((f) => order[f.severity]);
    assert.deepEqual(sev, [...sev].sort((a, b) => a - b), name);
  }
});

test("Writing Without Bullshit checks only run when asked", () => {
  const text = read("packaging.md");
  const off = scan(text);
  const on = scan(text, { wwb: true });
  assert.equal(off.writing_without_bullshit, null);
  assert.ok(!off.findings.some((f) => f.code.startsWith("W")));
  assert.ok(on.writing_without_bullshit.intensifiers > 0);
  assert.ok(on.findings.some((f) => f.code.startsWith("W")));
});

test("empty and blank input don't throw", () => {
  for (const input of ["", "   ", "\n\n", undefined, null]) {
    const r = scan(input);
    assert.equal(r.words, 0);
    assert.deepEqual(r.counts, { strong: 0, moderate: 0, weak: 0 });
    assert.equal(r.strong_plus_moderate_per_100_words, 0);
    assert.equal(r.rhythm.sentences, 0);
  }
});

test("Windows line endings scan the same as Unix ones", () => {
  const text = read("sample-before.txt");
  assert.deepEqual(scan(text.replace(/\n/g, "\r\n")), scan(text));
});

test("a long paste scans in well under a second", () => {
  const big = read("sample-before.txt").repeat(60); // about 6,000 words
  const t0 = process.hrtime.bigint();
  const r = scan(big, { wwb: true });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(r.words > 5000);
  assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`);
});

test("the clean sample has no strong or moderate hits", () => {
  const r = scan(read("sample-after.txt"), { wwb: true });
  assert.equal(r.counts.strong, 0);
  assert.equal(r.counts.moderate, 0);
});
