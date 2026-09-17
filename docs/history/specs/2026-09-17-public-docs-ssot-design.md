# Public Documentation Single Source of Truth

Status: Designed (2026-09-17). Implementation plan to follow.

## Context

The `docs/` restructure (2026-09-16) settled the maintainer documents. The public documents were left
as they were, and they repeat each other:

- The feature list lives in `README.md`, `landing/index.html`, `landing/docs/index.html` and
  `docs/prd.md`, each worded differently. CLI install paths live in `README.md`, `docs/cli.md` and
  the site.
- `landing/docs/index.html` is hand-written HTML, so the website is also the only source of the user
  guide. Without the site the content would not exist anywhere.
- `deploy-landing.yml` deploys on every push to `main` that touches `landing/**`. Updating the guide
  with a feature commit advertises the feature before it is released.
- Most documentation tests lock sentences rather than facts. They make copy harder to change and
  miss real drift: `README.md` lists `PLVS_x64-portable.zip`, `releaseWorkflowContract.test.js`
  asserts exactly that string, and the release actually ships `PLVS-v<version>-x64-portable.zip`
  (see `scripts/changelog-release-body.mjs`). All three README package names are wrong.
- `docs/architecture.md`, `docs/prd.md` and `CONTRIBUTING.md` are largely Chinese, although English
  is the project's working language.

## Goals

1. Every kind of public information has exactly one full source; other documents summarise and link.
2. Content is independent of the website; the site is one rendering of it.
3. Facts that code owns are checked against the code; prose is reconciled by a checklist at release.
4. Nothing user-visible reaches the website before it is released.

## Non-goals

- A documentation site generator or multi-page site. The guide still renders as one page.
- Tests over prose or marketing copy.
- Auditing `docs/design-tokens.md` (deferred separately).

## Design

### 1. Roles

| Document               | Reader                             | Answers                                               |
| ---------------------- | ---------------------------------- | ----------------------------------------------------- |
| `landing/index.html`   | Someone deciding whether to try it | Why use PLVS                                          |
| `docs/user/`           | Someone using PLVS                 | How each feature works — the single source            |
| `README.md`            | A GitHub visitor                   | What it is, where to download, docs, how to contribute |
| `CHANGELOG.md`         | Anyone tracking changes            | What changed in each version                          |
| rest of `docs/`        | Maintainers and agents             | Why the code is the way it is                         |

`README.md` becomes an entry page of roughly 100 lines: one-paragraph description and screenshot, a
short list of highlights, the panel names in one line, the download table with first-launch notes,
a one-line CLI pointer, a short Development section linking `CONTRIBUTING.md`, Acknowledgements and
License. Limitations, Quick Start and the CLI walkthrough move to `docs/user/`. The README no longer
states the Node version; `CONTRIBUTING.md` already names `.nvmrc` as its source.

### 2. Sources per kind of information

| Information                          | Single source                           | Elsewhere                                  |
| ------------------------------------ | --------------------------------------- | ------------------------------------------ |
| Feature behaviour                    | `docs/user/`                            | README highlights; landing selling points  |
| Limitations and known issues         | `docs/user/` FAQ chapter                | README links                               |
| Packages and system requirements     | `docs/user/` Getting Started            | README and landing download summaries      |
| Version changes                      | `CHANGELOG.md`                          | —                                          |
| CLI reference                        | `docs/user/cli.md` (moved from `docs/`) | Guide CLI chapter introduces; README links |
| Product intent and non-goals         | `docs/prd.md`                           | Landing copy is written from it            |
| Development setup and commands       | `CONTRIBUTING.md`                       | README links                               |
| Panels, layouts, versions, filenames | Code                                    | Documents may state them; tests check      |

### 3. `docs/user/`

- One file per chapter, following the current site sections: Getting Started, Signal Source,
  Panels, Dialogue-Gated Loudness, Multichannel, Workspace, File Mode, CLI, System Settings, FAQ.
- `docs/user/README.md` is the index and defines chapter order.
- Written in English, readable on GitHub without the site.
- `docs/README.md` gains a "User documentation" group; `docs/agent-control/` stays maintainer-facing.
- Content is refreshed against 0.16.0 and the code while converting from HTML.

### 4. Website

- `landing/docs/` keeps its current look as a template (navigation, sidebar, styles). A small build
  script renders the chapters in index order into that template at deploy time.
- `deploy-landing.yml` runs when a release is published, plus `workflow_dispatch`, not on push to
  `main`.

### 5. Checks

Order of preference: generate, then test against code, then checklist.

**Generated** — `docs/agent-control/generated/` stays as it is. The site guide page is generated from
`docs/user/`.

**Tested against code**, organised by fact in `scripts/documentationStructure.test.js`:

| Fact                     | Code source                                                      | Assertion                                                                  |
| ------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Panels                   | `MODULE_CATALOG`                                                 | The Panels chapter lists exactly these                                     |
| Auto-detected layouts    | `src/math/channelLayoutTable.js`                                 | The Multichannel chapter lists exactly these                               |
| macOS minimum version    | `tauri.conf.json` `bundle.macOS.minimumSystemVersion`            | Every version stated in public documents equals it                         |
| Package filenames        | A filename helper extracted from `changelog-release-body.mjs`    | Every package name in public documents matches it                          |
| CLI commands             | `commandManifest` plus the commands that run without the app     | Every `plvs-cli <command>` in public documents exists                      |
| Structure                | —                                                                | Index chapters exist; internal links resolve; no links into `docs/history/` |

Existing tests:

| Test                                              | Change                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `landing/index.test.js`                           | Drop copy and old-asset locks; keep download fallback, subscribe form, responsive |
| `landing/docs/index.test.js`                      | Replaced by a test of the guide build                                             |
| `scripts/cliDocumentationContract.test.js`        | Removed; replaced by the CLI command assertion                                    |
| README assertions in `releaseWorkflowContract`    | Removed; replaced by the package filename assertion                               |
| `scripts/documentationStructure.test.js`          | Kept and extended as above                                                        |

**Checklist**

- Development time (`AGENTS.md`): a change to user-visible behaviour updates the matching
  `docs/user/` chapter in the same commit. It reaches the site only at release. This replaces the
  current "updates `README.md` in the same commit" rule.
- Release time (`skills/plvs-release` Step 4b): for this release's CHANGELOG entry, confirm that
  every user-visible change is in `docs/user/`; whether README highlights need adjusting; whether
  landing selling points need adjusting; whether screenshots need retaking.

No automated "code changed without a docs change" warning: most feature commits do not affect the
guide, and a warning that is usually wrong gets ignored.

### 6. Language

All documentation is English. `docs/architecture.md`, `docs/prd.md` and `CONTRIBUTING.md` are
translated, and `AGENTS.md` Code style states the rule. The bilingual installation notes that
`scripts/changelog-release-body.mjs` appends to GitHub Releases stay bilingual; they are for people
downloading PLVS.

## Implementation order

Each step is a separate commit and passes `npm run check`.

1. Translate `docs/architecture.md`, `docs/prd.md`, `CONTRIBUTING.md`; add the language rule.
2. Create `docs/user/` from the site content, refreshed against 0.16.0; move `docs/cli.md` and
   update references.
3. Generate the site guide from `docs/user/`; deploy on release.
4. Replace sentence-locking tests with the fact checks.
5. Slim `README.md` and correct package filenames.
6. Update `docs/README.md`, `AGENTS.md` and `skills/plvs-release` Step 4b.
