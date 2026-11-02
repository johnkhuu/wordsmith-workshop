# Wordsmith Workshop

A one-page site for the Wordsmith Workshop Claude skill: a writing studio that drafts and audits personal writing, built on Minto's Pyramid Principle and checked for AI-writing tells.

The page opens on a 30-second film, explains how the skill works in three steps, and shows each method with a before, an after and the reasons for every change. It also includes a working copy of the skill's tell scanner, so anyone can paste a draft and see what it flags.

## What's here

| Path | What it does |
|---|---|
| `index.html` | The page and all of its copy |
| `assets/style.css` | Styles: the Dawn palette (warm white, ink, and a peach-to-violet gradient), with light and dark themes |
| `assets/scanner.js` | The tell scanner, ported from the skill's `scripts/tell_scan.py` |
| `assets/app.js` | Connects the scanner to the page: highlights, report, samples |
| `assets/methods.js` | The method tabs (every method shows if JavaScript is off) |
| `assets/film/` | The 30-second explainer film: drawing kit, scenes, synthesized score and sound, player, and the voiceover clips |
| `tools/film/` | Re-recording the voiceover and exporting the film as an MP4 |
| `vercel.json` | Tells Vercel to serve the files as they are, with no build step |
| `tests/` | Unit tests for the scanner and browser tests for the page |
| `.github/` | CI, PR convention checks, PR and issue templates, Dependabot |

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

The unit tests check the scanner against results saved from the skill's Python script, including cases just either side of every threshold. The browser tests load the page in Chromium and use it the way a visitor would. CI runs both on every pull request.

## Contributing

Every change starts as an issue and lands through a pull request into `main`, one change per pull request. Branches are named `type/<issue>-short-description`, pull request titles follow Conventional Commits, and each pull request closes its issue. CI checks all three. [CONTRIBUTING.md](CONTRIBUTING.md) has the full workflow, the naming rules, the QA checklist and how to keep the scanner in step with the skill.

## Deploy

Vercel deploys every branch as a preview and `main` as the live site. `vercel.json` tells it the site is static files with no build step.

To use GitHub Pages instead, go to Settings, then Pages. Under "Build and deployment," choose "Deploy from a branch," pick `main` and the `/ (root)` folder, and save.

## Credits

Methods from Barbara Minto (Pyramid Principle, SCQA, MECE), Josh Bernoff (Writing Without Bullshit) and Cole Nussbaumer Knaflic (Storytelling with Data). The tell catalog is adapted from [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) (WikiProject AI Cleanup, CC BY-SA 4.0).

The scanner reports patterns. It is not an AI detector, and a hit is never proof of who or what wrote a piece.
