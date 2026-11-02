#!/usr/bin/env python3
"""Regenerate the scanner's expected results from the skill's Python scanner.

The site's JavaScript scanner (assets/scanner.js) is a port of the Wordsmith
Workshop skill's scripts/tell_scan.py. The unit tests check that the two agree
by comparing the JS output with results saved from the Python script. Run this
after the skill's scanner changes, then make the JS match until tests pass.

Usage:
    python3 tests/support/generate_expected.py /path/to/wordsmith-workshop/scripts/tell_scan.py
"""

import importlib.util
import json
import pathlib
import sys

FIXTURES = pathlib.Path(__file__).resolve().parents[1] / "fixtures"


def load_scanner(path):
    spec = importlib.util.spec_from_file_location("tell_scan", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.scan


def write_json(obj, path):
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main(argv):
    if len(argv) != 2 or argv[1] in ("-h", "--help"):
        print(__doc__)
        return 1
    scan = load_scanner(argv[1])
    written = 0

    # Whole-text fixtures: one result without --wwb and one with it.
    for src in sorted(FIXTURES.glob("*")):
        if src.suffix not in (".txt", ".md"):
            continue
        text = src.read_text(encoding="utf-8")
        write_json(scan(text), src.with_name(src.stem + ".expected.json"))
        write_json(scan(text, wwb=True), src.with_name(src.stem + ".expected-wwb.json"))
        written += 2

    # Boundary cases: small texts that sit just either side of each threshold.
    cases = json.loads((FIXTURES / "boundaries.json").read_text(encoding="utf-8"))
    expected = {c["name"]: scan(c["text"], wwb=c["wwb"]) for c in cases}
    write_json(expected, FIXTURES / "boundaries.expected.json")
    written += 1

    print(f"Wrote {written} expected-result files to {FIXTURES}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
