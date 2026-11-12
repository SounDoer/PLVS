# PLVS — Documentation

Documents here are grouped by **shelf life**, not by subject. Each group carries a different
maintenance obligation, and knowing which group a file belongs to is how you know whether to trust
it and whether you owe it an update.

Source of truth for any technical claim is the code on `main`. When a document contradicts the code,
the code wins — fix the document.

## 1. Current state — must be updated with the code

These describe how PLVS works right now. Changing the behaviour they describe and leaving them
alone makes them wrong, so they are updated in the same commit as the change.

| File                                               | Covers                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| [architecture.md](architecture.md)                 | Tech stack, directory map, audio pipeline, IPC, theme system           |
| [design-tokens.md](design-tokens.md)               | Desktop tokens, Theme structure and text casing                        |
| [glossary.md](glossary.md)                         | User-facing terms and their Chinese forms for subtitles and voice-over |
| [website-design.md](website-design.md)             | Website tokens, layout rules and browsing patterns                     |
| [pitfalls.md](pitfalls.md)                         | Counter-intuitive behaviour and the incident context behind rules      |
| [agent-control/](agent-control/)                   | Agent Control contract; `generated/` is produced by tooling            |
| [ffmpeg-sidecar-build.md](ffmpeg-sidecar-build.md) | How the bundled FFmpeg sidecar is built and fetched                    |

Keep this group small. Every file added here is one more thing that can go stale.

[Marketing screenshots](marketing-screenshots.md) documents how the homepage images are rendered
from fixtures, reviewed and published, the archived music sources behind them, and the self-contained
press kit export (`npm run presskit`).

Maintainer workflows are also current-state documents, but stay separate so that ordinary
contributors do not have to read low-frequency release and review procedures:

| File                                                                 | Owns                                                      |
| -------------------------------------------------------------------- | --------------------------------------------------------- |
| [desktop-development.md](desktop-development.md)                     | Dev identities, Linux capture and Preview packaging       |
| [visual-and-capture-validation.md](visual-and-capture-validation.md) | Theme, screenshot, smoke and soak review                  |
| [website-and-sharesets.md](website-and-sharesets.md)                 | Website, Catalogue and privacy-policy maintenance         |
| [release-operations.md](release-operations.md)                       | Release reviews, acceptance runners, recovery and signing |
| [dependency-license-review.md](dependency-license-review.md)         | Dependency and native-component licence review            |

Each fact has one owner. Other documents may give a short routing summary, but must link here
instead of copying the procedure.

## 2. User guide — [user/](user/)

How to use PLVS, written for people using the app, one file per chapter with
[user/README.md](user/README.md) as the index. It is the single source for how PLVS behaves: the
website docs page is rendered from it at release, and `README.md` only summarises and links to it.
[user/cli.md](user/cli.md) is the `plvs-cli` command reference. A change to user-visible behaviour
updates the matching chapter in the same commit.

## 3. Product boundaries

| File             | Covers                                                      |
| ---------------- | ----------------------------------------------------------- |
| [prd.md](prd.md) | What PLVS is for, what it deliberately does not do, and why |

The PRD states intent and limits. It does not inventory current capabilities — counts, feature
lists and "we currently don't have X" belong in [user/](user/) and `CHANGELOG.md`.

## 4. Engineering decisions and working records

Keep current constraints and their rationale in the relevant maintained document. Maintainers
keep full decision records, working specs, plans, investigations and mockups in PLVS-Notebook,
with the project that owns the work. See [AGENTS.md](../AGENTS.md) for the workflow.

The public snapshots preserve the [former ADR directory](https://github.com/SounDoer/PLVS/tree/421b7333059d94f36a41197ae9c7a0de11c96a66/docs/adr)
and [earlier working records](https://github.com/SounDoer/PLVS/tree/39a710db60eca7d478627d9e24806a45b10c0ba6/docs/history).

## Where the other documents live

`README.md`, `CHANGELOG.md` and the website under `website/` are written for people who do not
know the project. The README and website homepage summarise the user guide and are reconciled
against the changelog at release time; the website docs page is generated from `user/`.
`CONTRIBUTING.md` is the short entry point for environment setup, daily commands and CI.
`AGENTS.md` contains only non-obvious agent rules and routes detailed procedures here.

## Guards

Facts the code owns are checked by tests rather than by review, in
`scripts/documentationStructure.test.js`: the panels, auto-detected channel layouts, macOS minimum
version, release package names and `plvs-cli` commands named in public documents must match the
code; relative links must resolve; living documents must be usable without the private archive; Agent Control
pages must leave command syntax to `agent-control/generated/`. `scripts/build-user-docs.test.mjs`
checks that every chapter reaches the website. Prose is not asserted. They run as part of
`npm run check`.
