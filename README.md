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
| `vercel.json` | Tells Vercel to serve the files as they are, with no build step |

The site has no build step, no runtime dependencies and no backend. The scanner runs in the browser, so pasted text never leaves the page. Fonts load from Google Fonts.

## Run it locally

Open `index.html` in a browser, or serve the folder with any static file server:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000.

## Deploy

Vercel deploys every branch as a preview and `main` as the live site. `vercel.json` tells it the site is static files with no build step.

## Credits

Methods from Barbara Minto (Pyramid Principle, SCQA, MECE), Josh Bernoff (Writing Without Bullshit) and Cole Nussbaumer Knaflic (Storytelling with Data). The tell catalog is adapted from [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) (WikiProject AI Cleanup, CC BY-SA 4.0).

The scanner reports patterns. It is not an AI detector, and a hit is never proof of who or what wrote a piece.
