# PLVS — Documentation

This directory contains all development documentation for PLVS.
Standard reference docs live directly in `docs/`. Working and process docs live in `docs/working/`.

## Standard docs

| File | Purpose | Read when |
|------|---------|-----------|
| [prd.md](prd.md) | Product intent: what PLVS is, target users, features, non-goals | Understanding product scope and decisions |
| [architecture.md](architecture.md) | Technical map: tech stack, directory structure, audio pipeline, IPC, theme system | Writing code, navigating the codebase |
| [design-tokens.md](design-tokens.md) | UI token system: CSS variables, semantic tokens, theme structure | Working on visual appearance or theming |
| [loudness-references.md](loudness-references.md) | Loudness reference profile data for UI overlays | Adding or editing loudness reference targets |

## Decision records

| File | Decision |
|------|---------|
| [adr/0001-ui-layout-vs-shadcn-theme.md](adr/0001-ui-layout-vs-shadcn-theme.md) | `--ui-*` layout tokens vs shadcn/Tailwind surface tokens — boundary definition |
| [adr/0002-theme-id-and-appearance.md](adr/0002-theme-id-and-appearance.md) | `themeId`, `appearance`, `data-theme`, first-paint placeholder, chart token naming |
| [adr/0003-device-identity-layering.md](adr/0003-device-identity-layering.md) | Keep device DTO / pure id algebra / cpal enumeration split — do not merge |

ADRs are historical records — do not edit them. Add a new ADR to record a new decision.

## Working docs (`docs/working/`)

Process documents generated during development. Not maintained as living references.

| Path | Contents |
|------|---------|
| `working/design/` | Design handoff specs for implemented features (workspace layout, header/footer) |
| `working/superpowers/specs/` | Design specs produced during brainstorming sessions |
| `working/superpowers/plans/` | Implementation plans (including this one) |

## For AI agents

Start here, then read `architecture.md` for the codebase map. Key facts:
- Source of truth for any technical claim is the code, not this documentation
- If a doc contradicts the code, the code wins — update the doc
- All test files are colocated with source files in `src/` (pattern: `*.test.js` / `*.test.jsx`)
- Run `npm test` to verify frontend; `npm run check` for full stack
