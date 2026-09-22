# Community Pack, Catalogue and Preview

Date: 2026-09-22

Last consolidated: 2026-09-23

Status: Approved product and architecture direction; Theme V1 and exact defensive limits remain follow-up work

## Relationship to the foundation record

This record extends `2026-09-22-community-sharing-foundation-design.md`. It specifies the agreed
direction for Pack V2, validation and planning, the curated Community MVP, desktop transfer UX and
deterministic previews. It does not replace the separate Theme System Audit or Multi-Instance
Architecture Audit.

Where this record makes a later decision more specific than the foundation record, this record is
the accepted direction.

## Three layers

Keep these concepts distinct:

- An **Item** is the authored PLVS content: one Loudness Profile, Preset or Theme.
- A **Pack** is the JSON transport envelope used to validate and move one or more Items and their
  dependencies between installations.
- A **Catalogue record** is the website representation: description, tags, licence, releases,
  previews and immutable download identity.

A Pack is not an archive and contains no executable or binary assets. Configuration remains a
separate whole-application backup and is not a Community Item.

## Pack V2

### Families and extensions

Retain the three user-visible file families:

| Primary Item     | Pack kind       | Extension       |
| ---------------- | --------------- | --------------- |
| Loudness Profile | `loudness-pack` | `.plvsloudness` |
| Preset           | `preset-pack`   | `.plvspreset`   |
| Theme            | `theme-pack`    | `.plvstheme`    |

Do not replace them with one opaque `.plvspack` extension. The distinct extensions support file
discovery, accurate error messages and future operating-system associations.

### Independent versions

The Pack envelope and every Item document carry independent versions. A Pack version describes
transport organization and dependency representation. An Item version describes that content
model. Upgrading one Item family must not force unrelated Item families to increment.

`createdWith.appVersion` may be present for diagnostics but is never the compatibility authority.
Compatibility comes from Pack and Item versions plus required modules, metrics and capabilities.
Pack V2 does not require `exportedAt`; publication time belongs to the Catalogue and volatile export
time does not help import.

### Canonical envelope

Every Pack V2 has this top-level shape:

```json
{
  "app": "PLVS",
  "kind": "preset-pack",
  "version": 2,
  "createdWith": { "appVersion": "0.16.1" },
  "items": [],
  "dependencies": []
}
```

These are the only top-level fields. `createdWith` is optional. `items` is required and non-empty;
`dependencies` is required and may be empty. A Loudness or Theme Pack has no dependency groups. A
Preset Pack may have at most one `loudness-profile` dependency group, whose `items` array is
non-empty when the group exists.

Pack JSON is UTF-8 without a byte-order mark, formatted with two-space indentation and a final
newline. All numbers are finite JSON numbers. Property order is not semantically significant.
Export filenames are sanitized for the local filesystem; the Catalogue generates its own stable
download filename for each Release.

Parsing is staged: enforce the byte limit, parse JSON, validate `app`/`kind`/Pack version, convert
Pack V1 or strictly validate Pack V2, validate Item documents, validate the dependency graph, then
produce an internal plan. The parser neither repairs V2 content nor activates imported content.

### Primary Items

Normal desktop transfer may place multiple same-family primary Items in one Pack. A Community
release has exactly one primary Item so its page, release history, previews and compatibility have
one subject. Community validation enforces that additional restriction; the base Pack format does
not.

### Dependencies

Pack V2 replaces Preset Pack V1's special `loudnessProfiles` field with a general dependency list.
Each dependency group has a kind and an Item list. Loudness Profile is the only approved dependency
kind today. Theme is not implicitly captured by a Preset.

```json
{
  "kind": "loudness-profile",
  "items": [
    {
      "version": 1,
      "id": "profile-id",
      "name": "Broadcast",
      "referenceLufs": -23,
      "rules": []
    }
  ]
}
```

Rules:

- Packs are self-contained and never fetch a dependency from a URL.
- A dependency kind appears at most once.
- Item and dependency IDs are unique within their group.
- Several primary Items may reference one dependency.
- Every reference resolves inside the Pack.
- Strict Community publication rejects unused dependencies.
- Dependencies are one level deep in Pack V2; dependency groups cannot carry further dependencies.
- Import remaps dependency IDs before writing primary Items so an ID collision never makes a Preset
  point at a different local Profile.

An unused dependency is an ordinary desktop-import warning and a Community-publication error.

### Import semantics

Import remains merge-only, append-only and non-activating:

| Local state                            | Result                                                      |
| -------------------------------------- | ----------------------------------------------------------- |
| ID absent                              | Add under the incoming ID, subject to safe local allocation |
| ID present and canonical content equal | Skip                                                        |
| ID present and content different       | Add a copy under a new local ID and collision-free name     |

Names do not establish identity. Ordinary Import never overwrites an installed Item and never
means Community Update. A future explicit update feature is separate.

Pack V2 import is all-or-nothing. Any invalid primary Item or dependency rejects the complete Pack
before library mutation. It never silently filters Items. Pack V1 remains readable through a
tolerant legacy conversion that reports every repair and downgrade.

New exports write Pack V2. Existing extensions remain unchanged. An older PLVS build rejects Pack
V2 as a newer format instead of guessing.

### Identity

Item ID, Catalogue Listing ID, Catalogue Release number and schema version are separate identities.
Content hashes identify exact bytes, not authored Items.

Portable Item IDs accept existing safe PLVS IDs rather than requiring UUID syntax. The concrete
validator should allow 1–128 ASCII characters, require an alphanumeric first character, allow only
alphanumerics plus `.`, `_` and `-` afterwards, and reject `__proto__`, `prototype` and
`constructor`. Newly created Items use `crypto.randomUUID()`. The same ID text may exist in
different Item families, but duplicates within one primary or dependency group are invalid.

Names are trimmed, non-empty, single-line Unicode strings with no control characters and a maximum
of 64 characters. Duplicate names are allowed, renaming does not change an ID, and import never
silently truncates a name.

## Loudness Profile publication

### Portable Loudness Profile V1

The portable document has this exact direction:

```json
{
  "version": 1,
  "id": "profile-id",
  "name": "Broadcast",
  "referenceLufs": -23,
  "rules": [
    {
      "metricId": "integratedLufs",
      "op": ">",
      "value": -22,
      "severity": "warn"
    }
  ]
}
```

No additional properties are accepted. `referenceLufs` is always present and is either `null` or a
number from -70 through 0. Rules are ordered and have no independent IDs. Each rule contains only a
known stable `metricId`, an operator of `>` or `<`, a finite threshold, and severity `warn` or
`fail`. The operator identifies the side on which a breach occurs; equality is not a breach.
Labels, units and platform-standard descriptions are resolved by PLVS rather than copied into the
document. A defensive maximum of 64 rules is the current implementation target.

Canonical numeric precision is two decimal places for Correlation, integer precision for Dialogue
Coverage, and one decimal place for every other current threshold and for `referenceLufs`. JSON
integers such as `-23` are valid representations, and negative zero normalizes to zero. Pack V2
strict validation rejects non-canonical values instead of rounding them. Pack V1 migration may
repair them only while reporting a warning.

Mathematical domains are enforced: Correlation is `-1..1`, Dialogue Coverage is `0..100`, and LRA
and Dialogue Range are non-negative. Other thresholds must be finite but are not rejected merely
for falling outside a subjective industry-typical range.

Use one core model with two validation levels:

- **Editable** permits an intentionally unfilled rule row while retaining strict known fields,
  metric IDs, operators and severities.
- **Publishable** requires every rule to have a finite threshold and requires the document to have
  meaningful content: a reference or at least one complete rule.

Metric labels and units are resolved from stable metric IDs and are not copied into the document.
Publication applies hard mathematical domains, such as Correlation `-1..1` and Dialogue Coverage
`0..100`, but does not invent subjective "reasonable" LUFS or dBTP limits.

Impossible structure is an error. Suspicious but executable intent is a warning: exact duplicate
rules, unusual interval construction or severity ordering must not be silently rewritten. Dialogue
metrics are valid and produce derived capability information.

Likely warning classes include exact duplicate rules, an unreachable warning caused by a stronger
failure rule, unusual overlapping bounds, and reliance on a derived Dialogue capability. Required
metrics and features are derived for Catalogue compatibility rather than stored in the Item.

The existing Agent Control authoring shape remains the semantic source for rule editing. Create
operations do not need to accept an ID, but export attaches the stored Item ID and document version.

## Portable Preset V1

### Document shape

A portable Preset is semantic content, not a serialization of internal workspace stores:

```json
{
  "version": 1,
  "id": "preset-id",
  "name": "Analysis Workspace",
  "workspace": { "layout": null, "panels": [] },
  "presentation": {
    "alwaysOnTop": false,
    "focusView": {
      "autoHideControls": false,
      "compactPanels": false,
      "borderless": false
    },
    "panelOpacityPercent": 100,
    "glassEnabled": false
  },
  "dock": { "enabled": false },
  "loudnessProfile": { "dependencyId": null }
}
```

The document never exposes raw `tree`, `panelsById` or `panelControlsById` stores. Unknown fields
are invalid in V1.

### Workspace and layout

Each workspace panel contains a local unique safe `key`, known `moduleId`, optional custom `title`,
public semantic `controls`, module-specific semantic `axes`, and optional
`pinnedSize: { widthCssPx, heightCssPx }`. A default title is omitted so the receiving PLVS can
localize it. Arbitrary internal `panel.config` is excluded until that module has a registered
portable schema.

Layout nodes are:

- `{ "type": "panel", "key": "…" }`;
- `{ "type": "tabs", "active": "…", "children": [panel nodes] }`;
- `{ "type": "split", "direction": "horizontal|vertical", "weights": […], "children": […] }`.

Each declared panel appears exactly once, a tab's active key names one of its children, and split
weights, when present, are positive and normalized. The existing public limits of 64 panels and a
layout depth of 32 apply. An intentionally empty workspace is represented by `layout: null` and an
empty panel array, allowing a Dock-only Preset.

Axes use portable concepts rather than store wiring. Frequency axes contain `linked`, `minHz` and
`maxHz`; time axes contain `linked` and `windowSec`. Source/writable flags and history offsets are
not portable, and history offset resets to zero. Linked panels of the same axis kind must request
matching ranges so PLVS can reconstruct a shared viewport without guessing.

### Presentation and Dock

All presentation fields shown in the example are required. `panelOpacityPercent` is an integer from
0 through 100. Window bounds and monitor identity are never portable.

Dock is a discriminated value. Disabled Dock is exactly `{ "enabled": false }`. Applying it exits
Dock but deliberately does not overwrite the locally stored strip layout. Enabled Dock contains:

```json
{
  "enabled": true,
  "edge": "bottom",
  "reserveSpace": true,
  "heightCssPx": 80,
  "panels": []
}
```

Height is 56–160 CSS pixels. Dock panels form an ordered array and contain `key`, `moduleId`, an
optional custom `title`, optional `preferredWidthCssPx`, and public semantic `controls`. A module
may occur more than once. Preferred width is bounded by the module contract. Monitor identity is
excluded. Unsupported Dock, Glass or space reservation is an Apply-time warning with a defined
effective result, not an import-time loss of content.

### Loudness dependency and exclusions

`loudnessProfile.dependencyId: null` means Profile Off. A non-null ID must resolve to a bundled
Loudness Profile dependency. Import remaps it to the locally allocated dependency ID. Internal
selector strings such as `profile:<id>` never appear in the portable document.

Preset V1 excludes capture source/device, active Theme, measurements and history, maxima, transport
state, fullscreen, active/dirty flags, editor drafts, File Analysis paths, hover state and other
temporary UI. Current Theme is not bundled implicitly.

Export converts a saved Preset snapshot rather than the live working scene. If the scene has
unsaved changes, PLVS warns but does not capture or update them. Import adds the Preset and bundled
Profile only; it does not apply either. Pack V2 applies strict validation without silent repair,
while Pack V1 may migrate legacy data with explicit warnings.

## Validation and planning

### Three checkpoints

1. **Publish Validation** proves the Pack is complete, canonical, bounded, self-contained and
   generally renderable. It does not inspect an author's monitor or a recipient's audio device.
2. **Import Plan** checks support in the current PLVS build, computes conflicts and dependency ID
   remapping, and lists platform capabilities that may later adapt.
3. **Apply Plan** runs when a recipient explicitly applies a Preset and resolves live device,
   display, Dock, Glass, File Mode and editor state.

An Item may import successfully while carrying an Apply warning for a capability unavailable on
the current machine.

### Structured issues

Every issue has:

- `severity`: `error` or `warning`;
- a stable machine-readable `code`;
- a JSON path;
- a human message;
- optional structured details, including requested and effective values for adaptations.

Programs never classify errors by matching the English message.

Errors are conditions that cannot safely retain content meaning: unsupported versions, unknown
required modules or metrics, invalid layout, compiler failure, missing dependency, duplicate ID,
incomplete publishable rule or a resource-limit violation. Warnings describe deterministic and
visible adaptations or suspicious but executable authoring.

Import warnings describe retained incoming content and planned collision handling. Apply warnings
include requested and effective values whenever runtime capability adaptation changes the result.
Exact issue-code naming and defensive byte/count/string limits are implementation details unless a
choice changes visible product behavior.

The pure shared boundaries are conceptually:

```text
validatePublishablePack(pack)
planPackImport(pack, localLibraries, appCapabilities)
planPresetApply(preset, runtimeCapabilities)
```

Desktop UI, Agent Control, CLI and Community CI consume the same facts and do not restate the
rules.

## Desktop UX

### Export

Every saved Loudness Profile, Preset and Custom Theme receives an item-level `Export…` operation.
Settings retains multi-select library export. Both write the same Pack V2; item-level export
produces the one-primary-item shape accepted by Community publication.

PLVS does not collect Catalogue metadata during export. Author, description, free tags, licence,
release notes and previews belong to submission and Catalogue processing.

Export reads saved library content only:

- A modified active Preset exports its last saved snapshot and warns that the working scene has
  unsaved changes; export never captures or updates it.
- An open Theme or Loudness Profile draft must be saved before it is exportable.
- Built-in Themes are not transferable Items; a user first creates a Custom Theme.
- Loudness Profile export rejects incomplete rules or an entirely empty semantic document.
- Preset export displays what the portable conversion includes, excludes and bundles.

Preset export lists the selected Loudness Profile dependency and makes host-only omissions such as
window bounds and Dock monitor explicit.

### Import

Add one `Import Shared Item…` entry that accepts all three extensions and dispatches by Pack kind.
The review shows primary Items, dependencies, add/skip/copy dispositions, compatibility errors and
adaptation warnings before any write.

Import adds library content and never activates it. Completion may offer a second explicit action:
View, Use Theme, Use Profile or Apply Preset. That action uses existing business guards and may be
refused without undoing the successful import.

Append-only import remains allowed while a draft editor is open. It does not reinterpret or
discard the draft.

### Files and multiple running PLVS instances

The first Community release uses browser Download followed by `Import Shared Item…` in the chosen
PLVS instance. It does not require file association, a custom URL protocol or one-click install.

PLVS must not become globally single-instance merely to route shared files. Running several PLVS
instances for different App Sources is a legitimate scenario. Future file association requires a
separate multi-instance discovery and target-selection design; it is gated by the Multi-Instance
Architecture Audit.

## Catalogue model

### Listing, Release and Artifact

A **Listing** is the long-lived Community page and identity. It has an immutable platform ID, one
content type, mutable title/slug/description and free-form tags. Slug and title are not identity.

A **Release** is one publication of that Listing. The platform assigns a monotonically increasing
release number; author-facing display naming may be added later. A Release records publication
notes, compatibility and derived previews.

An **Artifact** is the exact immutable Pack file for one Release. It records generated filename,
byte length, SHA-256, Pack and Item versions, and an immutable download location. Published bytes
are never replaced. A correction creates a new Release. A serious problem withdraws the Release
without rewriting history.

Account and author identity are deferred, but the data model leaves author attribution on the
Listing rather than inside the PLVS Item.

### Official and Community

The only user-visible content classification is **Official** or **Community**. Official content is
published by the PLVS team; every other accepted Listing is Community content. There are no public
Validated, Reviewed or similar trust badges, and Community Loudness Profiles receive no extra
disclaimer or explanatory label. The browsing and detail UI does not add a short explanation of the
two labels. Validation and reviewed intake remain internal publication workflow, not a third
visible status.

### Free tags and computed facets

Tags are author-supplied free text, not a controlled vocabulary. Validation only applies hygiene:
trim, reject empty/control-character values, bound lengths and count, and de-duplicate using a
normalized comparison while preserving display spelling. Autocomplete may suggest existing tags
but never constrains them.

Reliable filters are separate, machine-derived facets: Item type, module IDs, metric IDs, Theme
scheme, required features and compatibility. Authors cannot override those facts with tags.

### Compatibility

Compatibility is derived from Pack/Item versions and required modules, metrics and capabilities.
The Catalogue may translate capability history into a minimum PLVS version. Optional capabilities
such as Dock or Glass are shown as adaptations rather than hard incompatibility where the portable
contract defines a safe fallback.

### Static curated MVP

The first Community release is a statically generated, curated catalogue with:

- a landing page and Theme, Preset and Loudness Profile browsing;
- search over title, summary, description and free tags;
- reliable system-facet filtering;
- a detail page with preview, content summary, dependencies, compatibility, licence, size, hash,
  download, install instructions and Release history;
- a submission instructions page and reviewed intake process;
- independent deployment when Catalogue content changes, without waiting for a desktop release.

Website code and Community content are separate build inputs even if the initial storage happens to
share infrastructure. This preserves a migration path to a separate content repository and object
storage without changing Listing IDs or URLs.

The MVP excludes accounts, ratings, comments, follows, favourites, download rankings, automatic
updates, `Open in PLVS`, an in-app Community browser and unreviewed instant publication.

## Deterministic previews

Primary Community visuals are generated from the immutable Artifact. The MVP does not require or
accept author screenshots as its primary preview.

The Preview Renderer uses production React panels, Canvas renderers, Workspace layout and Theme
compiler with a deterministic runtime adapter:

- fixed viewport, device scale, locale, fonts and renderer version;
- fixed versioned measurement/history fixtures;
- disabled persistence, network, audio engine, animations and live clock;
- a stable-render barrier before capture.

Preset preview renders its actual portable Workspace and, where present, a separate Dock surface.
Theme preview applies the Theme to a canonical module and state gallery defined after the Theme
Audit. Loudness Profile preview generates a rules/reference summary and may include a fixed Stats
example.

The Catalogue renderer should run in a pinned browser environment for repeatability. Existing
native Visual Capture remains useful for periodic Windows/macOS parity checks against the same
fixture; native capture of a live user session is not the Catalogue preview source.

Preview metadata records Artifact SHA-256, renderer version, fixture version, viewport and image
SHA-256. Renderer or fixture upgrades may regenerate derived previews without changing the
immutable Artifact.

## Untrusted-input boundary

Pack files contain structured JSON only. They do not embed scripts, arbitrary CSS, HTML, SVG,
fonts, images, executable content, filesystem paths or remote dependency URLs. Theme values pass
through typed colour and compiler boundaries; strings such as panel titles always render as text.

Enforce byte limits before JSON parsing, then depth, count, string and domain-specific limits.
Public IDs have bounded syntax and reject dangerous reserved object-property names. Code handling
untrusted IDs uses `Map` or null-prototype records instead of relying on ordinary object prototype
semantics.

Catalogue Markdown is restricted and sanitized; raw HTML and embedded active content are not
accepted. Generated preview images are the standard visual path. Artifact downloads use attachment
and no-sniff response headers. Desktop PLVS always revalidates a downloaded Pack even when its hash
matches the official Catalogue.

## Delivery order

1. Complete the separate Theme System Audit and settle the portable Theme document.
2. Write exact Pack V2 and Item schemas, limits, migrations and issue codes.
3. Implement pure validators, portable converters, Import Plan and Apply Plan.
4. Switch desktop and CLI transfer to Pack V2 while retaining Pack V1 import.
5. Add item export and unified `Import Shared Item…` review.
6. Build the deterministic Preview Runtime and golden fixture matrix.
7. Build the curated static Catalogue and independent content deployment.
8. Consider file association only after the Multi-Instance Architecture Audit.
9. Consider accounts, direct publishing, `Open in PLVS`, provenance and update workflows as
   separate later products.

## Open details

The following are intentionally not fixed here:

- exact defensive byte, depth, string and collection limits beyond the product-facing limits above;
- exact stable issue-code names;
- licence choices and submission/legal workflow;
- account, author verification and moderation implementation;
- tag hygiene limits and display rules beyond free-form semantics;
- release display names;
- final Theme schema and preview gallery;
- physical hosting provider, repository split and object storage;
- integrated Community install, provenance and update behavior;
- multi-instance persistence, discovery and file-open routing.
