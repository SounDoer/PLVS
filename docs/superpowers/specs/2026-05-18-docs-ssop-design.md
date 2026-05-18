# Docs SSOP Redesign — Design Spec

**Date:** 2026-05-18  
**Scope:** Reorganize and rewrite all documentation under `docs/` to achieve Single Source of Truth — consistent, accurate, and readable by both humans and AI agents.

---

## Problem

- `docs/architecture.md` and `docs/prd.md` still reference "AudioMeter" throughout
- Docs were written by different agents at different times; content may diverge from the actual codebase
- `docs/adr/` contains non-ADR design handoff files mixed with real ADRs
- No navigation index exists — agents landing in the repo have no entry point into the docs
- `docs/superpowers/` sits at the same level as standard docs with no clear separation of role

---

## Target Structure

```
docs/
  README.md                  # Navigation index + agent entry point (new)
  prd.md                     # Product intent (rewrite)
  architecture.md            # Technical decisions + directory map (rewrite)
  design-tokens.md           # UI token spec (minor update)
  loudness-references.md     # Reference data (keep as-is)

  adr/                       # Architectural Decision Records only
    0001-ui-layout-vs-shadcn-theme.md
    0002-theme-id-and-appearance.md

  working/                   # All process and working docs (new dir)
    design/                  # Design handoff docs (moved from adr/)
      workspace-layout/
      header-footer.md
    superpowers/              # AI-generated specs and plans (moved from docs/superpowers/)
      specs/
      plans/
```

Root-level files (`README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`) stay at root — they follow GitHub conventions and are not dev docs. `CONTRIBUTING.md` still references "AudioMeter" and should be updated as a follow-on task (out of scope for this design).

---

## Per-File Rewrite Strategy

### `docs/README.md` (new)

Table format: one row per file/directory, columns: **File**, **Purpose**, **Read when**.  
Final section notes what `working/` contains and why it's separate from canonical docs.  
This is the first file any agent should read after cloning.

### `docs/prd.md` (rewrite)

Covers product intent only — not implementation.

Sections:
- What PLVS is (one paragraph)
- Target users
- Core features (Peak, Loudness/LUFS, Vectorscope, Spectrum, Spectrogram)
- Explicit non-goals (no plugin, no Linux, no cloud, no auto-update for now)

Source of truth: current feature set as observed in `src/`. Remove any technical implementation detail (belongs in architecture). Target: ~100 lines.

### `docs/architecture.md` (rewrite)

Covers how PLVS is built — not what it does.

Sections:
1. **Tech stack** — Tauri 2 (shell), React + Vite (frontend), Rust (audio engine + IPC), Vitest (tests)
2. **Directory map** — `src/` module breakdown, `src-tauri/` structure, `public/worklets/`, `scripts/`
3. **Key technical decisions** — audio pipeline (Rust AudioWorklet → IPC → React), token system, workspace layout persistence, theme system
4. **What lives where** — quick reference for "where do I add X?"

Remove: CI/release workflow (covered in `CONTRIBUTING.md`), roadmap, anything referencing AudioMeter.  
Audit against actual code before writing. Target: ~300 lines.

### `docs/design-tokens.md` (minor update)

- Replace any remaining "audiometer" references with "plvs"
- Verify token names against `src/theme/builtinThemes.js` and `src/preferences/`
- No structural changes

### `docs/loudness-references.md` (keep)

Pure reference data. No changes unless an audit finds inaccuracies.

### `docs/adr/` (clean up only)

- Move `design_handoff_workspace_layout/` → `docs/working/design/workspace-layout/`
- Move `Header Footer Redesion.md` → `docs/working/design/header-footer.md`
- Do not edit the two ADR files (they are historical records)

---

## Rewrite Process

Each rewrite follows this order:

1. **Read current doc** — identify what's there
2. **Audit against code** — for every technical claim, verify against `src/` and `src-tauri/`
3. **Write new version** — accurate, trimmed, no AudioMeter references
4. **Run `npm test`** — confirm nothing broken by any incidental changes

Architecture rewrite requires the deepest audit: directory structure, module names, IPC protocol, audio pipeline, token application flow.

---

## Success Criteria

- `docs/README.md` exists and gives a complete map of all docs in under 30 lines
- `docs/prd.md` contains no implementation details, no AudioMeter references, ≤150 lines
- `docs/architecture.md` matches actual `src/` structure, ≤350 lines, no AudioMeter references
- `docs/adr/` contains only ADR files
- `docs/working/` exists and contains the moved design handoff docs and superpowers working docs
- `npm test` passes after all changes
