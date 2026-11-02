# Wordsmith Workshop

A one-page site for the Wordsmith Workshop Claude skill: a writing studio that drafts and audits personal writing, built on Minto's Pyramid Principle and checked for AI-writing tells.

The page explains the skill's five layers, its methods and formats, and the craft standard. It also includes a working copy of the skill's tell scanner, so anyone can paste a draft and see what it flags.

## What's here

| File | What it does |
|---|---|
| `index.html` | The page and all of its copy |
| `assets/style.css` | Styles, with light and dark themes |
| `assets/scanner.js` | The tell scanner, ported from the skill's `scripts/tell_scan.py` |
| `assets/app.js` | Connects the scanner to the page: highlights, report, samples |

No build step, no dependencies, no backend. The scanner runs in the browser, so pasted text never leaves the page. Fonts load from Google Fonts.

## Run it locally

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000.

## Publish with GitHub Pages

In the repository on GitHub, go to Settings, then Pages. Under "Build and deployment," choose "Deploy from a branch," pick the branch that holds this site and the `/ (root)` folder, and save. The site appears at `https://<owner>.github.io/wordsmith-workshop/` a minute or two later.

## Keeping the scanner in step with the skill

`assets/scanner.js` copies the patterns, thresholds and severities from `scripts/tell_scan.py` in the skill. When the Python script changes, make the same change in the JavaScript. The JS version adds character offsets to each finding so the page can highlight it, and otherwise returns the same result object as `tell_scan.py --json`.

To check that the two agree, run both over the same text and compare the output. In Node:

```js
const { scan } = require("./assets/scanner.js");
console.log(JSON.stringify(scan(text, { wwb: true }), null, 2));
```

## Credits

Methods from Barbara Minto (Pyramid Principle, SCQA, MECE), Josh Bernoff (Writing Without Bullshit) and Cole Nussbaumer Knaflic (Storytelling with Data). The tell catalog is adapted from [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) (WikiProject AI Cleanup, CC BY-SA 4.0).

The scanner reports patterns. It is not an AI detector, and a hit is never proof of who or what wrote a piece.
