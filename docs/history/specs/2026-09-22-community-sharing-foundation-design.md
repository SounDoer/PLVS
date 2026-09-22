# Community Sharing Foundation

Date: 2026-09-22  
Status: Approved direction; detailed schemas and the Theme audit remain separate follow-up work

## Purpose

PLVS will add a substantial website area where people can publish, discover and download PLVS
Loudness Profiles, Presets and Themes. Before designing the publishing service, PLVS needs stable,
portable and accurately validated definitions of those three artefacts.

This record captures the decisions that precede the detailed format work. It deliberately does not
settle author identity, accounts, moderation workflow or the final Theme model. Those subjects do
not need to block the portability foundation.

## Vocabulary

Use the following names consistently in product copy and new code:

| Concept | Product name | Code vocabulary | File |
| --- | --- | --- | --- |
| A user-authored loudness rule set | Loudness Profile | `loudnessProfile*` | `.plvsloudness` |
| The complete application setup | Configuration | `configuration*` | `.plvsconfig` |
| A saved working scene | Preset | `preset*` | `.plvspreset` |
| A colour system authoring document | Theme | `theme*` | `.plvstheme` |

The existing persisted configuration kind, `configuration-profile`, remains readable for backward
compatibility. Ambiguous implementation names such as `profileShape`, `PROFILE_VERSION` and
`exportProfile` may be migrated to Configuration terminology as a separate, compatibility-safe
cleanup. The community must never use the unqualified word "Profile" for a Configuration.

Configuration files are backup and migration artefacts. They replace the recipient's setup and
are not publishable community items.

## Separate the portable contract from persistence

The current transfer system already provides three extensions, a common pack envelope, merge-only
import and Preset-to-Loudness-Profile bundling. It is a sound direct file-sharing implementation,
but its documents are not yet a stable public publishing contract.

The public path must have an explicit conversion boundary:

```text
Internal application state
    -> export conversion
Portable authoring document
    -> pack
.plvsloudness / .plvspreset / .plvstheme
```

Persistence objects may evolve for application needs without silently changing the community
format. Import performs the inverse conversion after validating the portable document.

Pack and item documents are versioned independently. Existing Pack V1 files remain readable. The
exact Pack V2 and item schemas will be settled only after the field audits; this record establishes
the boundary rather than freezing a speculative JSON shape.

## Catalogue records and PLVS artefacts are separate

Website metadata must not become part of PLVS runtime state:

```text
Catalogue record
  - author identity
  - description, tags and licence
  - screenshots and previews
  - publication versions and moderation state
  - compatibility declarations
  - immutable artefact hash
        -> PLVS artefact
           - portable primary item
           - portable dependencies
```

This lets a PLVS file continue to work when shared directly without the website. It also lets
catalogue copy change without changing the artefact hash. An author string inside an uploaded file
would not prove identity, so identity belongs to the publishing service. Whether publishing is
anonymous or account-based is intentionally deferred.

The normal transfer UI may continue to export multiple items in one pack. A community listing has
one primary item and zero or more dependencies so that its detail page, screenshots, compatibility
and version history have one clear subject.

## Loudness Profile direction

A portable Loudness Profile needs its own document version. It contains the identity and display
name, optional reference loudness and a list of complete rules.

Local editing may retain an unfilled rule row as draft state. Publication must reject an incomplete
rule rather than silently omit it. The public contract must also define:

- stable metric IDs that are never reused for a different meaning;
- the unit and semantics associated with each metric ID;
- supported operators and severities;
- name, rule-count and numeric limits;
- compatibility behaviour for metrics unknown to the importing build.

Unknown metrics and malformed rules are visible validation failures for publication. The current
behaviour of filtering invalid entries is not sufficient for a public catalogue.

## Preset direction

### Two different Preset representations

A local Preset snapshot faithfully restores one machine's scene. A Portable Preset expresses the
shareable intent of that scene. They are not the same document.

Portable Preset should build on the existing public Agent Control vocabulary rather than expose the
raw persistence shape. In particular, the existing public Workspace layout already has strict
known-field validation, module validation, depth and panel-count limits, and semantic panel control
and axis shapes.

During export, persisted panel IDs become artefact-local keys. During import, PLVS allocates local
panel IDs and rewrites every layout reference. This prevents an author's local identities from
colliding with the recipient's library or Workspace.

### Field disposition

| Local field or concept | Portable disposition | Rule |
| --- | --- | --- |
| Workspace tree | Convert | Serialize as the public layout tree using artefact-local panel keys |
| Panel records and order | Convert | Preserve known module, optional title and layout membership |
| Panel controls | Convert | Use public module-scoped semantic controls, not persistence keys |
| Pinned panel sizes | Adapt | Preserve as preferred CSS sizes and constrain on the target surface |
| Frequency viewports | Preserve | They express the intended analysis view |
| History window length | Preserve | It expresses the intended time scale |
| History offset | Reset | It is transient navigation into the author's past data; import as zero |
| Fullscreen panel | Remove | It is transient UI state |
| Window bounds | Remove | Coordinates and dimensions are host-specific |
| Always On Top | Optional presentation | Preserve when authored and show it in apply preview |
| Focus View | Preserve | The three flags are portable presentation intent |
| Panel opacity | Preserve with capability check | Clamp to the supported range |
| Glass | Preserve with capability check | Warn and ignore where unsupported |
| Dock enabled state and edge | Preserve | They are part of the authored working scene |
| Dock monitor identity | Remove | It is host-specific |
| Dock reserve-space choice | Preserve | Show it explicitly in apply preview |
| Dock height, panel sizes and controls | Adapt | Preserve as CSS-size preferences and constrain to the target display |
| Loudness Profile selection | Dependency | Store Off or a reference to a bundled portable Loudness Profile |
| Preset active/dirty state | Remove | Library relationship and working-state bookkeeping are not content |

Channel and channel-pair choices remain part of panel intent. If the target device exposes fewer
channels, import/apply adapts them to a valid selection and reports a structured warning.

### Compatibility outcomes

Portable Preset validation and preflight distinguish three outcomes:

1. **Compatible**: apply the full document.
2. **Compatible with adaptations**: apply it and report every effective fallback, such as Dock or
   Glass being unavailable, a channel selection being clamped, or a preferred size being reduced.
3. **Incompatible**: refuse before mutation for a newer unsupported document version, invalid
   layout, unknown required module, missing required dependency or another condition that would
   destroy the Preset's core meaning.

Unknown required modules are never silently removed. Import adds the Preset to the library without
activating it; presentation and operating-system effects happen only when the user later applies
the Preset through the existing scene-operation path.

A selected Loudness Profile must travel as a dependency of a community Preset. Legacy direct-share
files may continue to degrade a dangling reference to Off for compatibility, but that downgrade
must be reported. A newly published strict artefact with a missing declared dependency is invalid.

## Dependencies

Pack V1 gives Preset packs a special top-level `loudnessProfiles` array. The next format should use
a general dependency representation so a future portable relationship does not require another
special top-level field. Loudness Profile is the only approved dependency today. Theme is not part
of a Preset, and this work does not add it implicitly.

The final dependency schema must support ID remapping during merge so an imported Preset always
points to the exact dependency document it travelled with, including when an ID collision causes a
copy to be created.

## Theme direction and mandatory audit

Theme V2 is the current persistence and runtime authoring format, not proof that the public sharing
model is final. The Theme system underwent a large refactor, but its detailed semantic design and
the default Light and Dark visual results have not yet received the depth of validation required
for a public ecosystem.

A separate Theme System Audit is a gate before freezing the portable Theme schema. It must review:

- whether every visible colour is owned by a Theme role and whether any hard-coded or locally
  derived colours remain;
- whether Core Colors, Palettes, Interface, Data, Meter, module, Effect, CSS, Canvas and native
  classifications have coherent boundaries;
- whether role dependencies, recipes and compatible references express the intended semantics;
- whether roles are missing, redundant, too specific or too broad;
- whether the Theme Editor exposes the right authoring layers and understandable groupings;
- whether schema validation and compiler/registry compatibility validation occur at the correct
  boundaries;
- whether V1-to-V2 migration preserves visual intent;
- whether the built-in Dark and Light Themes need changes for contrast, hierarchy, trace
  separation, states, status colours, frequency colours and spectrogram intensity;
- whether representative renders cover every module and important interaction state.

The audit starts from the current implementation but may recommend restructuring it. This document
therefore makes no decision that would force the current role registry, recipes, token values or
default palettes into the future public format.

## Validation boundary

One set of pure validators and converters should serve:

- desktop import and export;
- Agent Control and CLI import, export and validation;
- community upload validation;
- repository or service CI that validates every published artefact.

Publication is stricter than tolerant legacy import. A published item must be complete, canonical,
within size/count/depth limits, valid against its item schema, and successfully compile or adapt
against its declared PLVS compatibility target. Validation must return structured errors and
warnings with document paths. Invalid items must not disappear silently and a completely invalid
pack must not be reported as an already-imported no-op.

## Website rollout

The current website is statically deployed. A fully open publishing platform would add accounts,
uploads, storage, moderation, abuse handling, copyright processes, search and metrics. Do not make
those systems a prerequisite for validating the content model.

Use this order:

1. Audit the three content models, including the separate Theme audit.
2. Specify item documents, Pack V2, compatibility and migration.
3. Implement shared validators, converters, preview plans and tests.
4. Move desktop and CLI transfer onto the portable boundary while retaining Pack V1 import.
5. Launch a curated, statically generated catalogue with validated immutable artefacts.
6. Decide whether demand justifies accounts and direct publishing, then design that service
   separately.

The curated first release should support category browsing, search, tags, detail pages, screenshots,
licence and compatibility information, and downloads. Submission and review may initially be a
controlled repository or another reviewed intake process.

## Deferred decisions

- anonymous publication versus accounts and verified author pages;
- moderation, reporting, copyright and licence enforcement workflow;
- ratings, favourites, download counts and social features;
- the exact Pack V2 JSON shape and extension strategy;
- final document version numbers and migrations;
- final Theme authoring document, registry and built-in palette changes;
- whether the eventual desktop app includes an integrated community browser.

These deferrals do not block the portability and validation work.
