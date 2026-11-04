# Shared Floating Editor Height

The Palettes page could expand the Dock authoring window almost to the monitor height. Its native
size report included the entire scrollable body, while the ordinary editor used an 80vh CSS limit.
Long pages therefore had different sizing behavior in the two presentations.

Theme and Loudness Profile editors now share a preference-owned policy: compact intrinsic height
for short pages, capped at 600 CSS px and 80% of the available height. The normal presentation uses
the application viewport; the native presentation uses the monitor containing the editor. The
native host adds 16 CSS px of transparent frame gutter. It must not budget against 80% of its own
viewport, because resizing that viewport would create a shrinking feedback loop.

Both presentations keep editor chrome outside the shrinking scroll body. Theme Preview retains its
separate viewport and restores the bounded editor size when closed. Feedback sizing is unchanged.

## Validation

Windows embedded dev build, isolated app data, WebView scale 2:

- Dock Palettes changed from 864 × 1814 to 864 × 1232 physical pixels, including frame gutter.
- Dock Core remained 864 × 776 pixels and byte-identical to the prior screenshot.
- Normal Core, Palettes, and Advanced fit the 80% budget of the 500 CSS px application viewport.
- Scrolling Dock Palettes reached Frequency and Interface controls; screenshot crops of the title,
  tabs, and footer remained pixel-identical before and after scrolling.
- Theme Preview remained 1632 × 1600 physical pixels with a fully transparent outer corner.
  Closing it restored Palettes to 864 × 1232 pixels.

Focused frontend tests cover stable bounded measurement, both editors and Interface Sizes, CSS token
publication, and unchanged Preview/Feedback sizing. A native unit test covers scaled monitor limits,
compact content, and the separate preview budget.
