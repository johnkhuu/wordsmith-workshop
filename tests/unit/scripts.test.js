// Every script the page loads must parse. A single stray quote stops a whole
// script, so this runs first and fails fast, before any browser test.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);

test("the page loads its scripts", () => {
  assert.ok(scripts.length >= 6, scripts.join(", "));
});

for (const src of scripts) {
  test(`${src} parses`, () => {
    const code = fs.readFileSync(path.join(ROOT, src), "utf8");
    assert.doesNotThrow(() => new vm.Script(code, { filename: src }));
  });
}
