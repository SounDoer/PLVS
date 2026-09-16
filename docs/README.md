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
| [engineering-pitfalls.md](engineering-pitfalls.md) | Counter-intuitive behaviour and the incident context behind rules  |
| [cli.md](cli.md)                                   | `plvs-cli` command reference                                       |
| [agent-control/](agent-control/)                   | Agent Control contract; `generated/` is produced by tooling        |
| [ffmpeg-sidecar-build.md](ffmpeg-sidecar-build.md) | How the bundled FFmpeg sidecar is built and fetched                |

Keep this group small. Every file added here is one more thing that can go stale.

## 2. Product boundaries

| File             | Covers                                                      |
| ---------------- | ----------------------------------------------------------- |
| [prd.md](prd.md) | What PLVS is for, what it deliberately does not do, and why |

The PRD states intent and limits. It does not inventory current capabilities — counts, feature
lists and "we currently don't have X" belong in `README.md` and `CHANGELOG.md`, which are updated
every release.

## 3. Decisions — [adr/](adr/)

A decision that still constrains the code, recorded once. ADRs are never edited; a decision that
changes gets a new ADR that supersedes the old one.

Write an ADR when someone could reasonably look at the code and ask "why not just do the obvious
simpler thing?" — layered device identity (0003) and three parallel VAD engines (0004) look
redundant until you know why they are not. Routine choices do not need one.

## 4. History — [history/](history/)

Specs, plans, performance investigations, spikes and mockups. Frozen the moment they are written,
never updated, never cited as current behaviour. See [history/README.md](history/README.md).

New specs go to `history/specs/YYYY-MM-DD-<topic>-design.md` and new plans to
`history/plans/YYYY-MM-DD-<feature>.md`; see the Documentation section in `AGENTS.md`.

## Where the other documents live

`README.md`, `CHANGELOG.md` and the site under `landing/docs/` are written for people who do not
know the project. They carry the highest cost when wrong and are reconciled against the changelog at
release time. `CONTRIBUTING.md` covers local development and CI. `AGENTS.md` carries the rules for
agents, including where to write new documents.

## Guards

Some claims are checked by tests rather than by review — the panel table in `README.md` must match
`src/workspace/moduleCatalog.js`, living documents must not link into `history/`, and the CLI
surface is asserted against `docs/cli.md`. They run as part of `npm run check`.
