# Contributing

Work moves from an issue to a branch to a pull request into `main`. CI tests every pull request, checks its naming and labels it by type. Each one gets a QA pass before it merges.

## The workflow

1. Start from a GitHub issue: a feature, a bug, or any other task. Use the Feature or Bug template, and say what should change and how a reviewer will know it's done.
2. Branch from `main` and name the branch after the issue: `type/<issue>-short-description`.
3. Make one change per branch, with tests. If a piece of work has several parts, split it into a stack of small pull requests (see [Stacked pull requests](#stacked-pull-requests)).
4. Run `npm test`.
5. Open a pull request into `main`. Give it a Conventional Commits title and put `Closes #<issue>` in the description. The template has a place for both, plus the testing, QA and bug-check sections.
6. Wait for the five required checks to pass: Unit tests, Browser tests, PR title, Branch name and Linked issue. A Type label job also labels the pull request from its title.
7. Squash and merge. The pull request's title becomes the commit message on `main`, and the linked issue closes.

## Naming

All three rules are checked in CI, and a pull request can't merge until it passes them.

### Pull request titles

Pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(optional-scope): summary
```

- The type is one of the types in the table below.
- The scope is optional and lowercase, for example `site`, `scanner`, `tests`, `ci`, `deploy` or `deps`.
- The summary is written as a command ("add", "fix", "remove"), and the whole title is 72 characters or fewer with no period at the end.
- Add `!` after the type or scope for a breaking change: `feat(scanner)!: rename the result fields`.

| Type | Use it for | Label |
|---|---|---|
| `feat` | Something new a visitor can see or use | `feature` |
| `fix` | A bug fix | `bug` |
| `docs` | README, CONTRIBUTING or code comments only | `documentation` |
| `style` | Formatting with no change in behavior | `style` |
| `refactor` | Restructuring code with no change in behavior | `refactor` |
| `perf` | A speed improvement | `performance` |
| `test` | Adding or fixing tests only | `tests` |
| `build` | `package.json`, dependencies, tooling, deployment config | `build` |
| `ci` | GitHub Actions workflows | `ci` |
| `chore` | Housekeeping that fits nowhere else | `chore` |
| `revert` | Undoing an earlier change | `revert` |

Examples:

- `feat(scanner): flag stock openers in subject lines`
- `fix(site): keep highlights aligned after a font swap`
- `docs: explain how to deploy on Vercel`

Editing the title re-runs the check and updates the label.

### Branch names

```
type/<issue>-short-description
```

The type matches the pull request's type. The issue is the number of the issue the branch closes. The description is a few lowercase words joined by single hyphens.

- `feat/12-scanner-stock-openers`
- `fix/15-highlight-alignment`
- `docs/18-vercel-deploy`

If a branch has the wrong name, rename it on the repository's Branches page (the pencil icon). An open pull request follows the rename.

Dependabot names its own branches and is exempt.

### Linked issue

The pull request description must close an issue with `Closes #<issue>`. `Fixes` and `Resolves` work too. GitHub then closes the issue when the pull request merges. Dependabot's dependency updates are exempt.

### Commit messages

Commit messages follow the same Conventional Commits format. On `main`, the squashed commit takes the pull request's title, so the title is the one that counts.

### Working with Claude Code

Claude Code sessions start on an automatically named `claude/...` branch, which fails the Branch name check. Tell the session which issue it's working on and ask it to use a `type/<issue>-short-description` branch.

## Stacked pull requests

When a change has parts that are easier to review separately, open them as a stack. Each part gets its own issue and its own branch, built on the previous part:

```
feat(scanner): add subject-line checks     feat/20-subject-lines         -> main
test(scanner): cover subject-line checks   test/21-subject-line-tests    -> feat/20-subject-lines
docs: explain subject-line checks          docs/22-subject-line-docs     -> test/21-subject-line-tests
```

Review the parts in any order, and merge them bottom first. After the bottom one merges, merge `main` into the next branch and point that pull request at `main`. GitHub does the retargeting by itself if "Automatically delete head branches" is on. Then merge it and repeat.

CI only runs on a pull request whose branch already contains the workflows, so a stack that adds CI is checked from that part upward.

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

| Command | What it runs |
|---|---|
| `npm run test:unit` | Scanner tests (parity with the skill's Python scanner, boundary cases for every threshold, offsets, speed and edge cases), workshop logic tests, and film timeline tests |
| `npm run test:e2e` | Browser tests in Chromium: the scanner, the workshop, the method tabs, the film player, escaping, layout at four widths in both themes, and a scan of the page's own copy |
| `npm start` | Serves the site at http://localhost:8000 |

The browser tests block requests to other hosts, so they don't need the network and run with the fallback fonts.

## Keeping the scanner in step with the skill

`assets/scanner.js` is a port of the skill's `scripts/tell_scan.py`. The unit tests compare the two using results saved from the Python script in `tests/fixtures/`. When the skill's scanner changes:

1. Regenerate the expected results from the skill's script:

   ```bash
   python3 tests/support/generate_expected.py /path/to/wordsmith-workshop/scripts/tell_scan.py
   ```

2. Run `npm run test:unit`, and update `assets/scanner.js` until it passes.
3. If the change adds a new check or threshold, add a fixture or a boundary case in `tests/fixtures/boundaries.json` that triggers it. A unit test reads the list of checks from the scanner and fails if any of them has no fixture.

## Changing the workshop

The workshop's rules live in `assets/workshop-core.js`, and each one comes from the skill's method guides (`references/minto.md`, `references/methods.md` and `references/methods/*.md`). The page in `assets/workshop.js` only draws the four steps.

- `recommend` picks methods for a draft, following section 3 of `references/methods.md`.
- `polish` runs the desks' own passes (copy, line, copywriter, fact-checking) on any text. Each finding names its desk, and `deskReport` builds the sign-off board. Keep these to things a rule can decide reliably, and never flag a word just for being used often: the skill's guide treats repeating the right word as clarity.
- `diagnose` writes the Review step's flags. `tasks` turns each failed check into a fix card tied to the line it's about, using the map of slots that `assemble` returns.

- `slotCopy` holds each slot's label, hint and example. A method that owns a slot changes its label: the point becomes the Answer under SCQA, the Lede under Inverted Pyramid and the Big Idea under Storytelling with Data.
- `assemble` puts the slots in each method's order. The order follows the table in `references/methods.md`: Minto's skeleton first, then MECE's groups, then the opening and the order.
- `check` holds each method's checklist. Write a check as automatic only when a rule can decide it reliably; otherwise make it a `self` check (a question for the writer).
- `EXAMPLES` must match the "before" drafts in the Methods section. A unit test compares them.

When you change a check, run `npm run test:unit`. One test rebuilds each method's "after" example in the slots and fails if any of that method's checks complain about it, so the checks can't get stricter than the skill's own examples.

## Changing the film

The film in `assets/film/` is plain JavaScript drawing on a canvas. `film-scenes.js` holds the timeline (`CUES` for the voice, `T` for the moments the picture and sound hang on), and `renderFrame(ctx, t)` draws any moment from its timestamp alone. The score and sound effects in `film-audio.js` are synthesized from the same timeline, so moving a moment in `T` moves its sound with it.

- To change a spoken line, edit it in `tools/film/make_voiceover.py` and in `CUES`, re-record with `python3 tools/film/make_voiceover.py --models <folder>` (setup is in the script's docstring), then copy the new lengths from `assets/film/vo/durations.json` into `CUES`. The unit tests fail until they match, and they also check that the narration passes the scanner.
- To export the film for sharing: `node tools/film/export_video.js out/wordsmith-workshop-film.mp4`.

## QA checklist

The template asks for this on every pull request:

- Desktop width and phone width (about 390px)
- Light and dark mode
- No errors in the browser console
- Every control works with the keyboard, with visible focus
- Copy reads plainly and passes the scanner

## Repository settings

The repository owner sets these in GitHub, under Settings:

- General: set the default branch to `main`. Allow squash merging only, and turn on "Automatically delete head branches."
- Rules or Branches: protect `main`. Require a pull request before merging, and require these status checks to pass: Unit tests, Browser tests, PR title, Branch name, Linked issue.
- Vercel deploys every branch and `main` using `vercel.json`. Optionally set the Vercel project's Framework Preset to "Other" to match it.
