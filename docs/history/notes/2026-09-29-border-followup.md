# Border simplification: review follow-up

The first visual review retained idle split lines and shell outlines. The user requested that
split lines appear only when needed, and that Header, Footer, and the File analysis summary adopt
the same borderless treatment as panels.

## Changes

- Workspace split ink is transparent while idle, uses the existing Primary hover colour over its
  unchanged hit region, and remains full Primary during a drag or equal-size snap. The mouse cursor,
  divider spacing, minimum sizes, snapping, and resize calculations are unchanged.
- Header, Footer, and File summary lose their outer borders. Auto-revealed Header/Footer variants
  also lose their border but retain their opaque Raised surface and shadow.
- Input/control boundaries, floating menus, panel-location highlights, and Dock separators remain.

## Evidence

`artifacts/border-followup/` contains local Agent Control before/after galleries for both built-in
schemes. The added `file-shell` scene captures the whole window including the File summary and
Footer. The runner restores its temporary theme/source/session/control changes after each run.
Removing shell borders gives Workspace additional height; captures are not asserted pixel-identical.
`pixels.json` samples the inter-panel gap to verify removal of the idle resize line.

`resize-states.json` records a browser CSS interaction check using the actual divider classes and
built application stylesheet. The hit region remains 6 CSS px at the tested scale. Idle and
released-outside backgrounds are transparent, hover uses Primary at 70%, and holding the mouse
outside the original hit region retains opaque Primary. This checks CSS states rather than
replacing the existing resize and snapping tests.

Targeted shell, file summary, and split sizing tests passed (48 tests). Native screenshots were
visually inspected for both schemes. `npm run check` passed: 421 frontend files / 4,845 tests,
production build, Rust formatting, Clippy, and workspace tests. The full validation log is
`artifacts/border-followup/check.log`. `git diff --check` passed; the development GUI was stopped.
