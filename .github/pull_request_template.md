<!--
Title format: type(optional-scope): summary
Example: feat(scanner): flag stock openers
Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
72 characters at most, no period at the end. CI checks this.
-->

## Summary

<!-- What changed and why, in two or three sentences. Lead with the outcome. -->

## How it was tested

- [ ] `npm test` passes locally (unit and browser tests)
- [ ] New or changed behavior has a test
- [ ] If the scanner changed: expected results regenerated from the skill's `tell_scan.py` (see CONTRIBUTING.md)

## QA checklist

- [ ] Checked in a browser at desktop width and at phone width (about 390px)
- [ ] Checked light and dark mode
- [ ] No errors in the browser console
- [ ] Every control works with the keyboard, and focus is visible
- [ ] Copy changes read plainly and pass the scanner (the browser tests check the page's own copy)

## Bug check

<!-- What you looked for and ruled out, and anything still open. "None found" is a fine answer if you looked. -->

## Screenshots

<!-- Before and after, for anything visual. Delete this section if nothing on screen changed. -->
