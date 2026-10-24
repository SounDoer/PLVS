# Website design foundations

The website is a static site. Its design system is independent of the desktop application's
runtime Theme tokens described in `design-tokens.md`.

## Shared source

- `website/assets/site-tokens.css` owns the approved website foundation: Inter, semantic text
  and color roles, spacing, control height, and radii.
- `website/assets/site-components.css` owns shared controls, resource cards, and responsive
  site navigation. `site-navigation.js` supplies the Menu interaction.
- `scripts/site-components.mjs` renders shared navigation and resource-card markup.
- `website/assets/sharesets.css` and `sharesets.js` compose those pieces for catalogue browsing.

The Sharesets root, category listing pages and all three resource detail families consume this
shared source. Detail layouts remain in `sharesets-detail.css`; gallery and copy interactions remain
in `sharesets-detail.js`. The homepage, documentation and Privacy pages also consume the shared tokens and site chrome.
The documentation generator uses the shared navigation renderer with Docs marked as current;
`website/assets/docs.css` owns only its reading layout, chapter navigation, tables and code blocks.
Guide content and chapter anchors continue to come from `docs/user/`.
The Privacy page uses shared typography and navigation, with its 760px reading column and policy
callout in `website/assets/privacy.css`. Presentation changes do not change its effective date.

## Agreed foundation

The homepage, Sharesets, Docs, and Privacy pages share `website/assets/site-tokens.css`, loaded by
`site-chrome.css`. These website tokens are separate from the desktop application's theme
contract. Page styles consume them without redefining the shared scale.

Use Inter throughout: 400 for reading, 500 for navigation, and 600 for headings and actions.

Typography uses 18px body text, 16px supporting text, and 20px card/subsection titles.
Section headings use 32px (28px at widths up to 620px), page headings 36px (32px), and
homepage display headings 44px (36px). Introductory copy uses the body-sized lead role.

Colors are semantic `--color-*` roles shared across pages, including text, surfaces,
dividers, controls, interaction states, and focus. Decorative background and shadow recipes
also live in the token file. Resource screenshots retain their original pixels and colors. The content width caps at 1180px with
24px outer gutters. Essential information must not depend on hover or color alone.

### Surfaces and Screenshots

All rounded website surfaces use 8px at every viewport size. Controls, panels, and previews
retain semantic token names, but share the same value; larger elements do not get larger corners.
Choose the token by the element's role:

| Role                                               | Token / radius           | Application                                                                                                                    |
| -------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Controls, tags, code surfaces, thumbnail selectors | `--radius-control` / 8px | The interactive or containing surface owns the radius.                                                                         |
| Cards, information panels, dialogs                 | `--radius-panel` / 8px   | The outer surface owns the radius.                                                                                             |
| Standalone product screenshots                     | `--radius-preview` / 8px | Homepage hero, galleries, Dock strips, editor screenshots, and Sharesets detail previews, at every viewport size.              |
| Images inside a card or thumbnail selector         | 0 additional radius      | A flush card image follows its clipping card's outer corners; an inset thumbnail stays rectangular inside its padded selector. |
| Enlarged image viewer                              | 0 on the image           | Keep the full source rectangle visible inside the padded dialog; the dialog keeps its own 8px radius.                          |

Apply screenshot rounding once, to the image or its clipping frame. Do not add a second
rounded frame around it. Logos and artwork retain their authored shape; circular icon controls
may use 50%. These exceptions do not create additional radius steps.

Preserve source proportions and interface content. Use automatic image height or `object-fit:
contain` in a fixed preview slot, never `cover`. Empty space in a fixed slot is acceptable.
Keep compact Dock screenshots horizontally scrollable when shrinking them would make the
readings unusable. Rounded corners must not hide labels or controls: inspect the source and
rendered corners, and use a padded frame if important content reaches the corners. CSS cannot
undo corners or crops already baked into a source image.

Borders, shadows, and backgrounds belong to the containing surface and use shared tokens;
do not stack the same decoration on both the frame and its image. The homepage hero uses
`--shadow-preview`; adding that shadow to other screenshots is not implied by their size.

### Layout and Enforcement

Repeated visual details also have shared roles: `--border-width` (1px), `--focus-width` (2px),
`--focus-offset` (3px), and `--code-padding-block` (2px). Focus rings inside scrollable containers
may use the negative focus width to avoid clipping. Ordinary links use `--link-underline-offset`
(3px); navigation selection underlines use `--space-2` (8px). Interaction transitions use
`--motion-fast` (150ms), and disabled controls use `--opacity-disabled` (0.45).
Headings use the shared tracking value; introductory labels use normal tracking.

Spacing uses `--space-*`; page gutters, content width, and minimum control height use named tokens.
Use the following defaults for the visible separation between related elements:

| Relationship                                    | Spacing                                                   | Examples                                                                                                |
| ----------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Closely related details                         | 8px / `--space-2`                                         | Tags, icon and text, field label and input, thumbnail selectors.                                        |
| Controls in one group                           | 12px / `--space-3`                                        | Action buttons, category selectors, search controls, subscription input and button.                     |
| Content groups inside a card; image and caption | 16px / `--space-4`                                        | Metadata, title, description, and tags; screenshot captions.                                            |
| Peer images or cards                            | 24px / `--space-5`                                        | Homepage galleries and image pairs, catalogue cards, download cards; keep this when wrapping into rows. |
| Introduction and its visual content             | 32px / `--space-6`                                        | Section heading/description to gallery; stacked detail preview and summary.                             |
| Separate major content groups                   | 48px / `--space-7`, reduced to 32px in the compact layout | Detail sections and large layout columns.                                                               |

Reserve 4px for tight internal details and 64/80px for page-level breathing room. Card padding
and page gutters remain 24px; do not confuse container padding with the gap between its children.
Sections with a divider may have padding on both sides of that divider: those are separate
insets, not an additional gap to stack on the same boundary. Related heading/subtitle text can
use 8px; paragraph rhythm uses 16px. Aligned card tags may consume remaining height with an auto
margin, but retain at least the 16px content-group gap.

Give each separation one owner: prefer parent `gap` for repeated children and clear their
competing margins. For an image caption or section transition, use one adjacent margin instead.
Review the rendered separation, including margin collapse, flex/grid gaps, and padding; simply
using a token does not prevent accidentally doubling the space. Responsive layouts may change
columns and major-group spacing, but must not arbitrarily change button or peer-card gaps.

Image aspect ratios, content-specific layout constraints, and responsive breakpoints remain
local layout geometry, rather than becoming one-off design tokens.
This also includes icon artwork/view boxes, image slot sizes, content-driven grid tracks, and
the Back to Top button's measured position (which reads its inset from the spacing token).
Zero resets, `auto`, `inherit`, unit line-height for centered controls, and the near-zero
reduced-motion override are intentional CSS mechanics, not extra design scale values.

Shared tokens are defined only in `site-tokens.css`, including their responsive values. Pages
may define scoped composition variables, but must not override the shared scale or reference
undefined tokens behind fallbacks. Typography, colors, and radii consume their semantic roles;
matching a token's current number is not a substitute for using that token. Source screenshots
are exempt from the website palette and typography scale.

`website/design-contract.test.js`, included in `npm run website:verify`, checks shared-token
ownership, reference validity, and typography, radius, spacing, color, stroke, shadow, and
interaction-detail usage across website CSS, embedded style blocks, and HTML style attributes.
The contract includes negative examples so that accidental literal values are proven to fail.
It does not inspect SVG artwork, dynamically generated JavaScript styles, or prove that a
locally scoped custom property is available on every matching element.
These static checks do not prove that the browser's final cascade or image pixels look right.
For visual changes, also review the affected homepage, Sharesets catalogue/detail/viewer, Docs,
and Privacy surfaces at desktop, tablet, and mobile widths as applicable. Check computed radii,
image proportions, corner content, and page overflow; scrollable images must stay usable.

## Browsing pattern

Category links select the resource family; do not duplicate them with a Type dropdown. Search
and the optional Tag filter intersect with the category. Tag choices come from published
listings. Active tags remain visible outside the collapsible filter panel. Clear All resets
category, query and tag together. Browser Back restores the category; current search and tag
remain in memory while changing categories, but are not persisted across a reload.

Cards contain one navigable link, real listing copy, author attribution and noninteractive tags.
Summaries are clamped to three lines, and tags stay aligned to the bottom of equal-height cards.
Theme cards prefer the existing workspace preview where available; no catalogue artifacts are
rewritten for presentation. Empty results have a clear recovery action. Without JavaScript,
category URLs and resource links remain usable; search controls are revealed only on enhancement.

Mobile navigation retains Download and reveals other destinations through Menu. Without
JavaScript, the links remain visible. Escape closes Menu and returns focus to its trigger.

Docs use a sticky chapter sidebar on desktop and a horizontally scrollable chapter list below
880px. The reading column caps at 760px; body text uses the primary text color, while secondary
labels use muted text. Wide tables and code blocks scroll within the reading column.
Chapter links use plain text with no filled background or side marker. The current chapter uses
primary text and an amber underline, matching site navigation. Chapter links jump immediately
to their anchors without animated scrolling.
Docs and Privacy share a neutral, 48px circular Back to Top control with a clear primary-text arrow.
On wide screens it sits 24px to the right of the reading column, near the bottom of the viewport;
on narrow screens it uses the bottom-right safe inset. It appears after
one viewport of scrolling, returns to the page top immediately and restores focus to the home
link in the site navigation. It stays hidden at the top and is only added when JavaScript runs.

## Review workflow

Review foundations, then component states, then combinations, then real pages. Local review
boards live in ignored artifacts and are not deployment inputs. Once a decision is applied,
record its durable rule here and use the shared source. Confirm desktop/mobile layout, keyboard
focus, empty states, and navigation behavior against real generated pages before expanding scope.

## Resource details

Theme, Preset and Loudness Profile pages share the two-column preview/summary layout with full-width sections below.
Downloadable content places Release History last, after Details, Panel Settings and any included
Loudness Profile, immediately before the footer. Themes and Presets use an image gallery; Profiles use a data-generated rule
summary, never screenshots. Both catalogue and detail summaries show the first three rules in
artifact order, with an accurate remaining-rule count; detail overflow links to full Details.
Theme product screenshots use the production first-run workspace and Panel Settings saved as the
PLVS Default Preset, with the generated PLVS Default Loudness Profile active. The renderer constructs this
fixture from production defaults rather than reading a maintainer's Library, so exports are
reproducible and stay aligned with the application. The audio Fixture generator derives its
analysis requests from that same default workspace and stores keyed results; no second set of
Spectrum, Spectrogram, Vectorscope or Stereo Map analysis settings is maintained for screenshots.
The Theme detail gallery exposes five fixed views in this order: Workspace, Snapshot, Spectrum,
Spectrogram and Theme Colors. Workspace uses the normal Live time direction; Snapshot shows the
same deterministic final frame frozen through PLVS's real Snapshot path. Theme Colors is the user-facing label for the generated semantic
overview. The remaining generated panel images stay sealed with the Release for validation but do
not appear in the gallery. The catalogue card uses Workspace as its cover.
Details groups all conditions by metric in label/value rows without a Rules subheading. Preset Details show readable module names, panel counts and Dock On/Off; omit Dock panel counts when disabled. Single-image galleries omit visible thumbnails and navigation arrows. Profile reference
values and rules are read from the validated release artifact during generation; metric labels
and units come from the application's Stats catalogue. Listing prose must not become a second
manually maintained source of rule values. Profile heroes use the concise Listing summary; longer
applicability, measurement and limitation guidance appears under Details before the generated rule
rows, with structured publisher links in Sources. Omit empty dependency sections and duplicate metric
compatibility listings. Current releases download from the top action; older published releases
use inline text download links in the history, and withdrawn releases have no download link.
Content built into PLVS replaces download actions with `Included with PLVS`. Its settings and
preview contract come directly from the production built-in registry; it has no import guidance,
file size, checksum, or Release History.

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
