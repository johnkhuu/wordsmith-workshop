# Wordsmith Workshop

A one-page site for the Wordsmith Workshop Claude skill: a writing studio that drafts and audits personal writing, built on Minto's Pyramid Principle and checked for AI-writing tells.

The page explains the skill's five layers, its methods and formats, and the craft standard. It also includes a working copy of the skill's tell scanner, so anyone can paste a draft and see what it flags.

## What's here

| Path | What it does |
|---|---|
| `index.html` | The page and all of its copy |
| `assets/style.css` | Styles, with light and dark themes |
| `assets/scanner.js` | The tell scanner, ported from the skill's `scripts/tell_scan.py` |
| `assets/app.js` | Connects the scanner to the page: highlights, report, samples |
| `tests/` | Unit tests for the scanner and browser tests for the page |
| `.github/` | CI, PR title checks, the PR template and Dependabot |

The site itself has no build step, no runtime dependencies and no backend. The scanner runs in the browser, so pasted text never leaves the page. Fonts load from Google Fonts.

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

The unit tests check the scanner against results saved from the skill's Python script, including cases just either side of every threshold. The browser tests load the page in Chromium and use it the way a visitor would. CI runs both on every pull request. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, the naming rules for pull requests and branches, and how to keep the scanner in step with the skill.

## Publish with GitHub Pages

In the repository on GitHub, go to Settings, then Pages. Under "Build and deployment," choose "Deploy from a branch," pick `main` and the `/ (root)` folder, and save. The site appears at `https://<owner>.github.io/wordsmith-workshop/` a minute or two later.

## Credits

Methods from Barbara Minto (Pyramid Principle, SCQA, MECE), Josh Bernoff (Writing Without Bullshit) and Cole Nussbaumer Knaflic (Storytelling with Data). The tell catalog is adapted from [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) (WikiProject AI Cleanup, CC BY-SA 4.0).

The scanner reports patterns. It is not an AI detector, and a hit is never proof of who or what wrote a piece.
