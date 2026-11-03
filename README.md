# Wordsmith Workshop

A one-page site for the Wordsmith Workshop Claude skill: a writing studio that drafts and audits personal writing, built on Minto's Pyramid Principle and checked for AI-writing tells.

The page opens on a 30-second film and explains how the skill works in three steps. Then comes the workshop, where anyone can turn a draft of their own into a clear message. Each method also has a before, an after and the reasons for every change. The page includes a working copy of the skill's tell scanner, too, so anyone can see what it flags in a draft.

The workshop runs in four steps, one screen at a time:

1. **Paste** a draft, or pick one of six examples.
2. **Review** what's holding it back: the draft sentence by sentence, with the buried point, the filler and the tells flagged in plain words. Methods are picked from the skill's own recommendation rules, and the visitor can change them.
3. **Fix**: the rewrite appears at once, followed by one card per line that still needs a change, with a progress bar. Where a rule can make the change, **Apply fix** makes it. Where the note needs the writer's words, the card suggests edits built from the draft itself, like *Could we push the deck from the 14th to ___?* A click uses the edit. If it has a blank (a date or a number only the writer knows), the edit goes into the box with the blank selected, and the card won't save until the blank is filled.
4. **Send**: the finished message to copy, a list of what changed, and the method guides' "ask yourself" questions.

Every draft also gets an editorial desk, modeled on how a publishing house edits. Six desks each sign their notes:

| Desk | What it checks |
|---|---|
| Structural editor | The point comes first, and each picked method's shape and checklist |
| Line editor | Long sentences, wordy phrases, double negatives, filler, stacked hedges, passive voice, sentences that all start the same way |
| Copy editor | Doubled words and punctuation, restated sentences and phrases, a name spelled two ways, times, amounts or dates written two ways |
| Fact-checker | A weekday that doesn't match its date ("Friday, 11/7" in 2026 is a Saturday), and dates that don't exist |
| Copywriter | An opener that announces instead of saying, a recap ending, the cover test (a detail only this message has), and tone: shouting, extra exclamation points, over-apologizing, harsh or passive-aggressive lines |
| Tell auditor | The skill's AI-tell scan |

The desks are checks written to each role's standard, from the skill's craft guide and tell catalog, not people. Repeating the right word is never flagged on its own: the skill's guide calls that clarity.

It uses no AI. Each method from the skill's guides becomes slots, an order and that guide's own checklist. The first pass sorts the visitor's own sentences into the slots and sets filler aside. Checks a rule can decide run automatically, like whether the point comes first or every number has a comparison. The rest are questions for the writer.

## What's here

| Path | What it does |
|---|---|
| `index.html` | The page and all of its copy |
| `assets/style.css` | Styles: the Dawn palette (warm white, ink, and a peach-to-violet gradient), with light and dark themes |
| `assets/scanner.js` | The tell scanner, ported from the skill's `scripts/tell_scan.py` |
| `assets/app.js` | Connects the scanner to the page: highlights, report, samples |
| `assets/methods.js` | The method tabs (every method shows if JavaScript is off) |
| `assets/workshop-core.js` | The workshop's logic: reading a draft, the first pass, assembling the rewrite and each method's checks. No page code, so it runs in Node for the tests |
| `assets/workshop.js` | Connects the workshop to the page: slots, sentences, the live rewrite, copy and the hand-off to and from the scanner |
| `assets/film/` | The 30-second explainer film: drawing kit, scenes, synthesized score and sound, player, and the voiceover clips |
| `tools/film/` | Re-recording the voiceover and exporting the film as an MP4 |
| `vercel.json` | Tells Vercel to serve the files as they are, with no build step |
| `tests/` | Unit tests for the scanner and browser tests for the page |
| `.github/` | CI, PR convention checks, PR and issue templates, Dependabot |

The site itself has no build step, no runtime dependencies and no backend. The scanner and the workshop run in the browser, so pasted text never leaves the page. Fonts load from Google Fonts.

## Run it locally

Open `index.html` in a browser, or serve the folder:

```bash
npm start
```

Then visit http://localhost:8000.

## Tests

```bash
npm ci
```

```bash
npx playwright install chromium
```

```bash
npm test
```

The unit tests check the scanner against results saved from the skill's Python script, including cases just either side of every threshold. They also cover the workshop's logic, including a test that each method's "after" example passes that method's checks. The browser tests load the page in Chromium and use it the way a visitor would. CI runs both on every pull request.

## Contributing

Every change starts as an issue and lands through a pull request into `main`, one change per pull request. Branches are named `type/<issue>-short-description`, pull request titles follow Conventional Commits, and each pull request closes its issue. CI checks all three. [CONTRIBUTING.md](CONTRIBUTING.md) has the full workflow, the naming rules, the QA checklist and how to keep the scanner in step with the skill.

## Deploy

Vercel deploys every branch as a preview and `main` as the live site. `vercel.json` tells it the site is static files with no build step.

To use GitHub Pages instead, go to Settings, then Pages. Under "Build and deployment," choose "Deploy from a branch," pick `main` and the `/ (root)` folder, and save.

## Credits

Methods from Barbara Minto (Pyramid Principle, SCQA, MECE), Josh Bernoff (Writing Without Bullshit) and Cole Nussbaumer Knaflic (Storytelling with Data). The tell catalog is adapted from [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) (WikiProject AI Cleanup, CC BY-SA 4.0).

The scanner reports patterns. It is not an AI detector, and a hit is never proof of who or what wrote a piece.
