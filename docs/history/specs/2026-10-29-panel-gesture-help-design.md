# Panel Gesture Help

The panel question mark is a contextual gesture reference. Keep metric explanations on metric
tips and setting explanations in settings. Stats needs no empty help button.

- Hover previews help. Moving into the help keeps it open; allow a short crossing delay.
- Click (including Enter/Space) pins the help, highlights the existing question mark and keeps it
  open after pointer exit. Click again, click outside, Escape, or window blur closes it.
- Bound the help to the whole viewport, not just the space above/below its trigger. Constrain its
  height, wrap long text and allow scrolling without affecting the underlying chart. Reposition on
  resize, content changes and scroll. Keep the question mark reachable: prefer positioning beside
  it for a long reference; when neither horizontal side fits, scroll on the larger vertical side.
  Keyboard users can focus and scroll the help.
- Render two aligned columns: operation and effect. Define modifiers, pointer gesture, target and
  effect explicitly; never infer icons from English text. Distinguish left/right button, wheel,
  hover and horizontal trackpad swipe. There is no middle-click gesture to document.
  Include the target in the operation label (for example, Time Axis · Wheel), using the same text
  style and natural wrapping, rather than a separate secondary line.
  Share content-sized columns across sections and let the card grow to fit them, bounded by the
  viewport. Do not split the card into equal-width columns or force a drawer width onto it.
- Use existing layout, icon, typography and theme tokens. Section headings use the reference's text token with
  medium weight and section spacing, not a fractional font size. Show Ctrl/Shift once as keycaps.
  Use Primary Text for headings, and Secondary Text for operations, effects, keycaps and icons.
- Resolve help using normalized controls, the panel's own Live/Snapshot state and axis visibility.
  Share mode/switch/state predicates with the actual conditional gesture handlers. Exclude
  unavailable gestures and empty groups; remove the question mark if no gestures remain.
- Keep help stable during silence, startup and empty history. Do not filter by transient data.
  Update open help in place when state changes; close if no gestures remain.
- Normalize names and Title Case, add the missing hover probes, and name Stereo Map's chart drag
  Pan Frequency. Keep 2D timeline and 3D viewpoint meanings separate.

Validation covers behavioral state transitions, contextual gesture predicates, both header mounts,
token contracts, viewport bounds at small/normal sizes, long content, enlarged Interface Size,
keyboard scrolling, themes and native Agent Control screenshots before/after. No audio pipeline or
persistence change is intended.
