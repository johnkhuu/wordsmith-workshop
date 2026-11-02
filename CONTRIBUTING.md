# Contributing

Every change goes through a pull request into `main`. CI tests each pull request and checks its title, and each one gets a QA pass before it merges.

## The workflow

1. Branch from `main`.
2. Make the change, with tests.
3. Run `npm test`.
4. Open a pull request into `main` and fill in the template.
5. Wait for CI to pass: Unit tests, Browser tests and PR title.
6. Squash and merge, so the pull request's title becomes the commit message on `main`.

## Naming

### Pull request titles (enforced)

Pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(optional-scope): summary
```

- The type is one of the types in the table below.
- The scope is lowercase, for example `site`, `scanner`, `tests`, `ci` or `deps`.
- The summary is 72 characters or fewer, written as a command, with no period at the end.
- Add `!` after the type or scope for a breaking change: `feat(scanner)!: rename the result fields`.

| Type | Use it for |
|---|---|
| `feat` | Something new a visitor can see or use |
| `fix` | A bug fix |
| `docs` | README, CONTRIBUTING or code comments only |
| `style` | Formatting with no change in behavior |
| `refactor` | Restructuring code with no change in behavior |
| `perf` | A speed improvement |
| `test` | Adding or fixing tests only |
| `build` | `package.json`, dependencies, tooling |
| `ci` | GitHub Actions workflows |
| `chore` | Housekeeping that fits nowhere else |
| `revert` | Undoing an earlier change |

Examples:

- `feat(scanner): flag stock openers in subject lines`
- `fix(site): keep highlights aligned after a font swap`
- `docs: explain how to publish with GitHub Pages`

The "PR title" check fails until the title follows these rules. Editing the title re-runs the check.

### Branch names (checked, warning only)

```
type/short-description
```

Use lowercase letters, digits and hyphens: `feat/scanner-stock-openers`, `fix/highlight-overlap`, `docs/pages-setup`. Branches created by Claude Code sessions start with `claude/`, and Dependabot's start with `dependabot/`. Both are accepted.

### Commit messages

Commit messages follow the same Conventional Commits format. The squashed commit on `main` takes the pull request's title, so the title is the one that counts.

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
| `npm run test:unit` | Scanner tests: parity with the skill's Python scanner, boundary cases for every threshold, offsets and edge cases |
| `npm run test:e2e` | Browser tests in Chromium: the report, highlights, samples, the Writing Without Bullshit switch, escaping, layout at four widths in both themes, and a scan of the page's own copy |
| `npm start` | Serves the site at http://localhost:8000 |

The browser tests block requests to other hosts, so they don't need the network and run with the fallback fonts.

## Keeping the scanner in step with the skill

`assets/scanner.js` is a port of the skill's `scripts/tell_scan.py`. The unit tests compare the two using results saved from the Python script in `tests/fixtures/`. When the skill's scanner changes:

1. Regenerate the expected results from the skill's script:

   ```bash
   python3 tests/support/generate_expected.py /path/to/wordsmith-workshop/scripts/tell_scan.py
   ```

2. Run `npm run test:unit`, and update `assets/scanner.js` until it passes.
3. If the change adds a new check or threshold, add a fixture or a boundary case in `tests/fixtures/boundaries.json` that triggers it. A unit test fails if any check has no fixture.

## QA checklist

The template asks for this on every pull request:

- Desktop width and phone width (about 390px)
- Light and dark mode
- No errors in the browser console
- Every control works with the keyboard, with visible focus
- Copy reads plainly and passes the scanner

## Repository settings

These are set by the repository owner in GitHub, under Settings:

- General: set the default branch to `main`. Allow squash merging only, and turn on "Automatically delete head branches."
- Branches: add a protection rule for `main`. Require a pull request before merging, and require these status checks to pass: Unit tests, Browser tests, PR title.
- Pages: deploy from the `main` branch, root folder.
