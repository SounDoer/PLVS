# Website design foundations

The website is a static site. Its design system is independent of the desktop application's
runtime Theme tokens described in `design-tokens.md`.

## Shared source

- `landing/assets/site-tokens.css` owns the approved website foundation: Inter, semantic text
  and color roles, spacing, control height, and radii.
- `landing/assets/site-components.css` owns shared controls, resource cards, and responsive
  site navigation. `site-navigation.js` supplies the Menu interaction.
- `scripts/site-components.mjs` renders shared navigation and resource-card markup.
- `landing/assets/sharesets.css` and `sharesets.js` compose those pieces for catalogue browsing.

The Sharesets root, category listing pages and all three resource detail families consume this
shared source. Detail layouts remain in `community.css`; gallery and copy interactions remain in
`community.js`. The homepage and documentation template retain their previous styles pending
separate review. Do not change those pages implicitly while extending the shared components.

## Agreed foundation

Use Inter throughout: 400 for reading, 500 for navigation, and 600 for headings and actions.
Use 36px page titles (32px on mobile), 24px section headings, 18px introductions and card titles,
16px body and control text, and 14px supporting labels. The homepage hero role is 44px, reducing
to 36px on mobile when the homepage adopts the system. Body line height is 1.6.

Use near-black page backgrounds, dark surfaces, near-white primary text, and legible gray
secondary text. Filled actions use homepage amber with dark text; links and keyboard focus use
brighter amber. Components consume named tokens rather than repeating raw colors.

Use the 4, 8, 12, 16, 24, 32 and 48px spacing scale, 8px control corners, 16px panel corners and a
44px minimum control height. The content width caps at 1180px with 24px outer gutters, reducing
to 20px on mobile. Essential information must not depend on hover or color alone.

## Browsing pattern

Category links select the resource family; do not duplicate them with a Type dropdown. Search
and the optional Tag filter intersect with the category. Tag choices come from published
listings. Active tags remain visible outside the collapsible filter panel. Clear All resets
category, query and tag together. Browser Back restores the category; current search and tag
remain in memory while changing categories, but are not persisted across a reload.

Cards contain one navigable link, real listing copy, author attribution and noninteractive tags.
Theme cards prefer the existing workspace preview where available; no catalogue artifacts are
rewritten for presentation. Empty results have a clear recovery action. Without JavaScript,
category URLs and resource links remain usable; search controls are revealed only on enhancement.

Mobile navigation retains Download and reveals other destinations through Menu. Without
JavaScript, the links remain visible. Escape closes Menu and returns focus to its trigger.

## Review workflow

Review foundations, then component states, then combinations, then real pages. Local review
boards live in ignored artifacts and are not deployment inputs. Once a decision is applied,
record its durable rule here and use the shared source. Confirm desktop/mobile layout, keyboard
focus, empty states, and navigation behavior against real generated pages before expanding scope.

## Resource details

Theme, Preset and Loudness Profile pages share the two-column preview/summary layout with full-width sections below.
Release History is the last content section, after Details, Panel Settings and any included
Loudness Profile, immediately before the footer. Themes and Presets use an image gallery; Profiles use a data-generated rule
summary, never screenshots. Both catalogue and detail summaries show the first three rules in
artifact order, with an accurate remaining-rule count; detail overflow links to full Details.
Details groups all conditions by metric in label/value rows without a Rules subheading. Preset Details show readable module names, panel counts and Dock On/Off; omit Dock panel counts when disabled. Single-image galleries omit visible thumbnails and navigation arrows. Profile reference
values and rules are read from the validated release artifact during generation; metric labels
and units come from the application's Stats catalogue. Listing prose must not become a second
manually maintained source of rule values. Omit empty dependency sections and duplicate metric
compatibility listings. Current releases download from the top action; older published releases
use inline text download links in the history, and withdrawn releases have no download link.

Catalogue preview areas share a 16:10 aspect ratio across all resource families. Text bodies
remain content-sized and cards in a row stretch to equal height. Profile summaries and full
Details use the artifact's strict comparison symbols (`>` and `<`) rather than Above/Below.

Preset detail data is derived from the current downloadable pack. Display presentation settings
and explicit Loudness Profile Off/name in Details. List each workspace and enabled Dock panel
separately in expandable Panel Settings rows; retain instance order and custom titles. Show saved
controls and axes with readable names and units, and explain that omitted controls use defaults.
Bundled Loudness Profiles show their complete rules using the shared Profile renderer. Catalogue
examples used during design review are not an approval of final launch content.

Panel Settings uses spacing rather than per-panel or per-setting divider lines. Do not expose
workspace ordinals; number only duplicate display names, and label Dock panels by their location.
