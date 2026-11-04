# ADR 0050: Dock Authoring Preserves the Floating Editor Presentation

**Status:** Accepted

**Date:** 2026-11-04

Supersedes the single-host presentation/lifetime decision in [ADR 0049](0049-dock-settings-uses-one-stable-presentation-host.md).
Its main-owned business state and explicit transport boundary remain in use.

## Context

A single wide Settings host bounded renderer count but made Settings much wider than its ordinary
drawer and stretched Theme/Profile editors into square, full-height pages. User review prefers the
ordinary editor's rounded surface, intrinsic layout, and independent dragging. An editor window's
retained memory should be addressed through its lifetime rather than changing that presentation.

Theme Preview is already a modal inside the ordinary application. A narrow authoring host must
provide enough viewport space for the same component without creating another preview renderer.
The old blanket Dock-entry refusal is also asymmetric once editors can survive both forms.

## Decision

Keep Settings and Saved Items export in the reusable `dock-settings` host, at the ordinary drawer
width. Create a separate fixed-label `dock-authoring` host on demand for the active Theme, Profile,
or Feedback flow. Render the same floating components with their ordinary dimensions and rounded
outlines. A shared drag service chooses native window dragging for this host and ordinary in-canvas
dragging for the normal application. Give only this accessory permission to drag its native window.

Measure the floating content instead of forcing it to fill an arbitrary fixed viewport. Preserve
physical positions for this application session and clamp restored bounds to an available monitor.
The authoring WebView reports its own scale for native geometry, screenshots, and named pointer
targets. Native window calls must not run while holding the remembered-bounds mutex.

Keep Theme Preview as the same modal component. Opening it expands the authoring viewport;
closing it restores the editor's base size and position. Main owns preview-open state along with
the draft, so form changes preserve both. Native hosts do not own preference stores or audio state.

Destroy the authoring WebView after its inactive client has acknowledged completion of outstanding
business actions and declared itself idle. Reopening requires a fresh readiness handshake. Repeated
entry focuses the existing active editor rather than allocating another one or replacing its draft.
Settings remains warm and reusable. Update/import accessories retain their existing coordination.

Dock entry permits only explicitly transferable editor registrations. Every preset operation and
any editor lacking a Dock presentation retain their blocking rules. Agent Control dry-run/planning
uses the same live blocker query; actual mutations still pass through the business guard.

File operations remain in main. Native dialogs prefer a visible authoring/Settings parent, or the
ordinary main window outside Dock. A menu export without an activatable host uses an unparented
system dialog rather than the activation-refusing Dock strip; its transient menu closes first.

## Consequences

- An active authoring flow costs one extra renderer. Closing releases it, with native/browser
  process reclamation occurring asynchronously. No immediate fixed memory reduction is promised.
- Theme Preview adds component rendering cost but no additional native window or WebView.
- Host sizing, native modality, geometry, and lifecycle differ between forms; shared controls,
  authoring semantics, and visual surface definitions remain common.
- Cross-monitor scale changes, native dragging, focus, and platform window behavior require desktop
  acceptance in addition to source and component tests.
