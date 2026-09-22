# PLVS — Documentation

Documents here are grouped by **shelf life**, not by subject. Each group carries a different
maintenance obligation, and knowing which group a file belongs to is how you know whether to trust
it and whether you owe it an update.

Source of truth for any technical claim is the code on `main`. When a document contradicts the code,
the code wins — fix the document.

## 1. Current state — must be updated with the code

These describe how PLVS works right now. Changing the behaviour they describe and leaving them
alone makes them wrong, so they are updated in the same commit as the change.

| File                                               | Covers                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| [architecture.md](architecture.md)                 | Tech stack, directory map, audio pipeline, IPC, theme system       |
| [design-tokens.md](design-tokens.md)               | CSS variable system, semantic tokens, theme structure, text casing |
| [pitfalls.md](pitfalls.md)                         | Counter-intuitive behaviour and the incident context behind rules  |
| [agent-control/](agent-control/)                   | Agent Control contract; `generated/` is produced by tooling        |
| [ffmpeg-sidecar-build.md](ffmpeg-sidecar-build.md) | How the bundled FFmpeg sidecar is built and fetched                |

Keep this group small. Every file added here is one more thing that can go stale.

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

## 4. Decisions — [adr/](adr/)

A decision that still constrains the code, recorded once. ADRs are never edited; a decision that
changes gets a new ADR that supersedes the old one.

Write an ADR when someone could reasonably look at the code and ask "why not just do the obvious
simpler thing?" — layered device identity (0003) and three parallel VAD engines (0004) look
redundant until you know why they are not. Routine choices do not need one.

## 5. History — [history/](history/)

Specs, plans, performance investigations, spikes and mockups. They may be refined while the work
they belong to is active, but they are not maintained to match the current product and are never
cited as current behaviour. See [history/README.md](history/README.md).

New specs go to `history/specs/YYYY-MM-DD-<topic>-design.md` and new plans to
`history/plans/YYYY-MM-DD-<feature>.md`; see the Documentation section in `AGENTS.md`.

## Where the other documents live

`README.md`, `CHANGELOG.md` and the website under `landing/` are written for people who do not
know the project. The README and the landing page summarise the user guide and are reconciled
against the changelog at release time; the website docs page is generated from `user/`. `CONTRIBUTING.md` covers local development and CI. `AGENTS.md` carries the rules for
agents, including where to write new documents.

## Guards

Facts the code owns are checked by tests rather than by review, in
`scripts/documentationStructure.test.js`: the panels, auto-detected channel layouts, macOS minimum
version, release package names and `plvs-cli` commands named in public documents must match the
code; relative links must resolve; living documents must not link into `history/`; Agent Control
pages must leave command syntax to `agent-control/generated/`. `scripts/build-user-docs.test.mjs`
checks that every chapter reaches the website. Prose is not asserted. They run as part of
`npm run check`.
