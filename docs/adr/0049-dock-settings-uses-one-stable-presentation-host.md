# ADR 0049: Dock Settings Uses One Stable Presentation Host

**Status:** Accepted

**Date:** 2026-11-04

## Context

The Dock toolbar already exposes Sources, Panels, Views, Presets, and Loudness Profile selection.
Opening Settings required returning to the normal window. Reusing the existing Dock editor looks
simple, but that editor is a transient menu: it closes on blur, sizes around its content, and leaves
extra transparent space for dropdowns. Settings can instead hold a long-lived authoring draft or
wait for a system file picker. Adding exceptions to the transient editor would mix these lifetimes.

Each native accessory also costs a WebView renderer. Giving Theme, Feedback, export, and every
future child flow their own native window would increase retained memory and focus relationships.

## Decision

Create one Settings accessory per workbench, on first use, and reuse it. It remains open on blur.
Settings, Theme/Profile authoring, Feedback, and Saved Items export share this host. Confirmation
dialogs and dropdowns stay within it. The normal window retains its existing Sheet presentation.
Both hosts render the same content and use the same business callbacks.

Keep preferences, authoring drafts, preview, persistence, native integrations, and submission in the
main application. The accessory receives view snapshots and sends explicitly declared actions with
session and request identities. It never mounts another SettingsProvider or writes domain stores.
An ordered dispatcher applies typing changes before Save; expired and duplicate actions are
rejected before mutation. Receipt acknowledgements distinguish user-paced native dialogs from an
unresponsive transport.

Mirror the accessory's UI surfaces and draft decisions into the main-owned navigation registries.
Navigation settles after native visibility and content readiness. Reopening a surface gets a new
surface identity even when it edits the same document again.

File operations still execute in main. A narrow native dialog boundary chooses the visible Settings
window as parent, falling back to main otherwise. This uses the dialog plugin's supported parent
API; the Dock strip may deliberately refuse activation and is unsuitable as the parent of a
Settings file picker. The accessory keeps event-only capabilities.

Existing update and import accessories remain separate. Their active flows temporarily suspend
Settings presentation while retaining its owner. Quick Tour and crash-report prompts retain their
normal-window requirements. Existing scene guards continue to protect open drafts, including clean
ones; no transition discards a draft to proceed.

## Consequences

- There is at most one additional retained renderer per workbench. Closing unmounts Settings
  content and stops its routine publication, but hiding the host does not promise to free its
  renderer memory.
- Window geometry, native modality, and transport are host concerns. Individual settings do not
  gain Dock-specific business implementations.
- Native geometry follows the frontend scale and Interface Size, fits the monitor, and responds
  to Dock geometry changes. The smaller transient Dock editors retain their compact geometry.
- UI, Draft Control, pointer targets, and screenshot capture must remain synchronized when the
  shared Settings surface changes. Performance and native focus require desktop verification in
  addition to component tests.

## Alternatives

- Copying Settings or mounting another SettingsProvider creates competing state and integration
  owners and is rejected.
- Expanding the meter strip to contain Settings entangles authoring with reserved-edge geometry
  and is rejected.
- Making normal Settings a native accessory too would change ordinary-window interaction and
  resource usage without being necessary for Dock support.
- Consolidating all existing update/import windows is a separate change; it is not required to
  keep the new Settings flow bounded.
