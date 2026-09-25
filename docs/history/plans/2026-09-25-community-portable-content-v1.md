# Community Portable Content V1 Implementation Plan

Date: 2026-09-25  
Status: In progress  
Design: `docs/history/specs/2026-09-25-community-portable-content-v1-design.md`

## Objective

Complete the portable boundary required by the curated Community catalogue. Move Loudness Profiles
and Presets to strict Pack V2 without breaking Pack V1 import, and make desktop, Agent Control, CLI
and future Community CI share the same validation and planning facts.

## Phase 1 — Loudness Profile vertical slice

- [x] Add a strict, id-free Portable Loudness Profile V1 validator and converters.
- [x] Reject incomplete rules, semantically empty Profiles, unknown fields and unsupported versions.
- [x] Write new Loudness exports with the shared Pack V2 envelope.
- [x] Keep tolerant Loudness Pack V1 import.
- [x] Make empty or invalid Agent Control exports fail as `loudnessProfileNotExportable`.
- [x] Enforce the encoded Pack byte/depth/item limits at the common file and Agent Control ingress.
- [x] Add publication assessment and canonical serialization/hash helpers.
- [x] Add item-level Export in the Loudness Profile UI.

Gate: a valid saved Profile round-trips V2 exactly; an incomplete or empty Profile fails before a
file is written; Pack V1 still imports.

## Phase 2 — Shared Pack V2 parser and issue model

- [x] Extract the Theme/Loudness envelope checks into one family-neutral parser.
- [x] Add required `severity` and optional structured `details` to transfer issues.
- [x] Enforce safe item IDs, duplicate detection and family limits consistently.
- [x] Add `validatePublishablePack` with the one-primary-item Community restriction.
- [x] Preserve family-specific messages only at UI/CLI presentation boundaries.

Gate: envelope behavior is table-tested across all three kinds and cannot drift by family.

## Phase 3 — Portable Preset V1 conversion

- [x] Define the exact Portable Preset schema in code from public Workspace, Panel and Axis
      vocabulary; do not expose persistence objects.
- [x] Convert saved Preset snapshots to artefact-local panel keys.
- [x] Convert public semantic controls and axes, and reject unknown required semantics.
- [x] Exclude host-only and transient fields.
- [x] Convert imported portable panels back to freshly allocated local IDs.
- [x] Cover empty Workspace, tabs, weighted splits, linked axes, repeated Dock modules and maximum
      depth/panel limits.

Gate: export/import/re-export is canonical, layout references remain complete, and no source panel
ID leaks into the imported Preset.

## Phase 4 — Dependencies and planning

- [x] Replace Pack V1 `loudnessProfiles` with one V2 `loudness-profile` dependency group.
- [x] Validate references, duplicate groups, duplicate IDs, missing and unused dependencies.
- [x] Remap dependency IDs before converting primary Presets.
- [x] Return Import Plan warnings for retained but suspicious content and collision outcomes.
- [x] Implement `planPresetApply` with requested/effective adaptations for platform, display, Dock,
      Glass, channels and preferred sizes.
- [x] Prove the Apply commit uses existing scene-operation guards before mutation.

Gate: strict Preset packs are all-or-nothing; importing never activates content; applying cannot
bypass blocking editors.

## Phase 5 — Desktop and CLI transfer UX

- [x] Switch Preset export to Pack V2 while retaining Pack V1 import.
- [x] Add item-level Export for saved Presets and custom Themes where not already exposed.
- [x] Replace per-row import entry points with `Import Shared Item…` dispatch by extension/kind.
- [x] Show dependencies, add/skip/copy outcomes, compatibility errors and adaptation warnings.
- [ ] Keep append-only import available while draft editors are open.
- [ ] Offer explicit post-import View/Use/Apply actions without rolling back a successful import
      when the action is refused.

Gate: GUI, Agent Control and CLI produce the same plan for the same Pack and local libraries.

## Phase 6 — Community handoff

- [ ] Add deterministic Loudness Profile and Preset preview inputs and golden fixtures.
- [ ] Expose a repository/CI validator for immutable catalogue artefacts.
- [ ] Produce the exact Catalogue metadata derived from Pack contents and compatibility facts.
- [ ] Hand the stable validator, hashes and preview contract to the static Catalogue implementation.

The website catalogue, submission workflow and independent content deployment are a subsequent
plan. Accounts, direct publishing, file association and `Open in PLVS` remain deferred.

## Verification

For every implementation phase:

```text
npx vitest run <focused transfer, library, protocol and UI tests>
npm run check
```

No capture-layer code is part of this work; capture smoke and soak are not required unless a later
phase changes `src-tauri/src/audio`, `dsp` or `engine`.
