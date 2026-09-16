# PLVS — Document history

**Everything below this directory is frozen.** These are point-in-time records: what we decided,
measured, or planned on the date in the filename. They are not maintained, and they do not describe
how PLVS behaves today.

## Rules

- **Never edit a file here**, including its `Status:` header. Whether something shipped is answered
  by git history and `CHANGELOG.md`, not by a status line in a spec.
- **Never cite a file here as the source of current behaviour.** If a record is the only place some
  current behaviour is described, that is a bug in the living docs: move the durable part into
  `docs/architecture.md` (what it is) or a new ADR (why it must stay that way), then link that.
- Source comments may cite a record as evidence ("measured in …"), because comments are versioned
  with the code they sit next to. Living documents under `docs/` must not link here at all.
- Links inside these files may be stale — they were written against the tree as it was.

## Layout

| Path       | Contents                                                                 |
| ---------- | ------------------------------------------------------------------------ |
| `specs/`   | Design specs from brainstorming sessions, one per feature                |
| `plans/`   | Implementation plans; usually paired with the spec of the same name      |
| `notes/`   | Everything else: performance investigations, spikes, roadmaps, audits    |
| `mockups/` | Static HTML/JSX prototypes used while designing the workspace and themes |

Filenames carry the date and topic (`2026-09-14-first-run-defaults-design.md`), so search by name
rather than looking for an index — an index here would go stale the moment it was written.

`notes/perf/` is worth knowing about: it is a full per-panel performance investigation, and it
records the cases that were measured and deliberately left alone, which are the conclusions most
easily lost.
