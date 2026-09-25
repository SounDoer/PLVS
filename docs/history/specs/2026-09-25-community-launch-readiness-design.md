# Community Launch Readiness

Date: 2026-09-25
Status: Approved

## Objective

Turn the completed static Catalogue and portable-content foundation into a maintainer-curated,
release-ready Community surface. The first launch contains one genuinely useful official Item from
each supported family and does not expose an empty Catalogue or any public submission workflow.

## Product boundary

This project publishes official curated content only. It does not add accounts, public submissions,
ratings, comments, favourites, download rankings, automatic Item updates, an in-app Community
browser, or an `Open in PLVS` deep link. Catalogue records contain no per-Item licence field.

The initial author label is `PLVS`, every initial Listing is classified `official`, and public copy
is English-only. Submission channels, contribution permission, and the separate content repository
remain deferred decisions.

## Launch visibility

An empty Catalogue is valid as a build input but is not a public product. Community navigation is
published only when the assembled content contains at least one visible Release. The first public
launch therefore travels with the first curated content set, through the normal PLVS Release
workflow. Later content-only updates use the isolated Community deployment workflow.

## Deterministic preview runtime

Catalogue previews show PLVS rather than a separate promotional-card design.

- A dedicated browser render entry hosts production React components in a preview-only harness.
- The harness never starts Tauri, the audio engine, persistence, networking, animation, or a live
  clock. The existing versioned fixture supplies every measurement and history value.
- Rendering uses a pinned Chromium toolchain, fixed viewport and device scale, English locale,
  Dark appearance, Default interface size, and the current PLVS theme compiler.
- The browser waits for fonts, two animation frames, and explicit canvas settlement before capture.
- Production panel, Workspace, Dock, Theme and Loudness Profile editor components remain the visual
  owners. Preview adapters may provide their contexts and data, but may not redraw approximations
  of those surfaces.
- The renderer writes only the exact asset IDs in the existing preview contract. It refuses extra
  screenshots, a partial set, non-PNG output, or output outside its requested directory.

The Loudness Profile output is the saved document shown in the real editor plus the real Stats
panel evaluated against the fixed measurements. A Preset output is the real Workspace and, only
when enabled by the Preset, the real Dock. Theme output keeps the semantic overview and the fixed
product scenes already defined by the Theme preview contract, rendered with the portable Theme.

Pixel hashes seal a generated publication, but are not asserted as cross-operating-system golden
hashes. The supported publication environment is the pinned renderer used by maintainers and CI;
structural tests own viewports, required assets, source identity and readiness rather than brittle
global screenshot snapshots.

## Curator workflow

One command accepts a candidate content directory and an output directory. For each new Release it:

1. validates the canonical Pack V2 artifact;
2. derives the versioned preview plan;
3. generates the complete preview set into Release-owned paths;
4. rewrites only that Release's preview path records;
5. validates the complete candidate source;
6. compares it with the exact published content commit when one exists;
7. builds a local static site for review.

The command is safe by default: it does not deploy, commit, modify an old Release, or reach outside
the candidate content root. Publication remains an explicit workflow action after review.

Withdrawal is one-way. A withdrawn Release loses its download action. If another published Release
exists, that one remains current. If every Release is withdrawn, the Listing disappears from browse
and search while its stable detail URL remains available with the withdrawal reason and history.

Rollback never rewrites Catalogue history. Before deployment, failure leaves the previous Pages
artifact live. After publication, bad content is withdrawn or superseded by a higher Release; an
older content tree is not redeployed as if the newer Release never existed.

## Initial official set

The launch set contains exactly three Listings:

- one new custom Theme that is not already built into PLVS;
- one general-purpose stereo Workspace Preset;
- one Loudness Profile named directly from its authored parameters, with no platform, broadcaster,
  certification, compliance, or endorsement claim.

Working content names are `Signal Amber`, `Stereo Overview`, and `I −23 ±0.5 · TP ≤ −1`.
The Profile intentionally matches PLVS's parameter-named starter logic; the Catalogue description
must state that it is an editable monitoring rule set, not a certified delivery standard.

The three Items are reviewed from their generated previews before their Listings enter the default
manifest. Test fixtures live outside the public manifest and are never presented as curated content.

## Acceptance

- One command generates every required preview from each of the three valid artifact families.
- Re-running the pinned renderer with the same inputs produces the same asset set, dimensions and
  source metadata.
- The real default Catalogue passes source, lineage and static-site validation.
- A fully withdrawn Listing is absent from browse/search but retains a non-downloadable detail page.
- Empty content assembly does not publish Community navigation.
- The first-party set contains one Official Listing per family, attributed to PLVS.
- The generated site works without JavaScript for navigation, content, downloads and withdrawal
  history; JavaScript remains an enhancement for search, filters and Theme copy.
- Full frontend tests and production build pass. The existing unrelated Rust clippy issue, if still
  present, is reported rather than hidden.
