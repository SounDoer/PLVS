# ADR 0048: macOS Dock Uses Panel Hosts and Space Membership

**Status:** Accepted

**Date:** 2026-11-03

## Context

An ordinary NSWindow with FullScreenAuxiliary cannot reliably accompany another application's
native full-screen Space. Dock needs its strip, toolbar and keyboard-capable editors there without
activating PLVS and switching Spaces. Changing only collection behavior is insufficient. Tauri's
public window builder does not expose an NSPanel constructor; replacing the native window loses
the framework's ownership, delegate or WebView identity.

## Decision

Use the macOS-only, exact-pinned community plugin `tauri-nspanel` 2.1.1 from crates.io. It converts
an existing native window to an NSPanel subclass and restores the original dynamic Tao class on
exit, preserving the WebView, label and original Tauri delegate. Keep the process's regular activation
policy. Dock Panels can become key for text input but cannot become main.

Class conversion has an explicit lifecycle boundary: finish Tao's deferred decoration changes on
the main dispatch queue before converting. Exit disables the native presentation owner, clears the
nonactivating mask through the plugin and restores the original class before normal Tao operations.
Before entry, retain the actual FullSizeContentView and transparent-titlebar policy. After decorations
settle on exit, restore that policy before physical bounds. A normal window changed through
Borderless can differ from the builder default; imposing that default shifts the content by one
title-bar height. Retain that policy as optional private metadata in the existing Dock persistence
record so boot restores the original normal policy rather than the new strip builder's default.
Legacy records without metadata retain their builder policy. Reuse normal decoration WebView size
synchronization after geometry. Main transitions run off AppKit's thread so these barriers never
block it. Accessories convert once after construction.
Do not replace Tauri's delegate or use Tao's focusability setter on a converted Panel.

An isolated harness verified the exact Tauri 2.12.2 / Tao 0.37.1 / plugin 2.1.1 combination, repeated
round trips with unchanged renderer and drafts, native full-screen editor input, visibility gating
and original-class restoration. Immediate conversion before queued styles settled reproduced a
WebKit KVO abort; the explicit queue boundary is required, not an optional delay.

A main-thread AppKit owner controls Dock presentation and Space transitions. Its transparent,
noninteractive ordinary NSWindow joins desktop Spaces but is ineligible for other applications'
native full-screen Spaces. Public `onActiveSpace` membership indicates which area to use on the
Dock display. Above Full Screen off hides all Dock windows while that probe is absent; on keeps
Panels visible. This avoids recreating WebViews and requires no Accessibility or capture permission.
Space/display notifications and bounded retries reconcile changes, with a one-second fallback
while Dock is wanted. Suspend and exit stop the fallback. The probe never accepts mouse input.

Desktop geometry uses `visibleFrame`; native full screen uses the display frame with safe-area
insets, including the notch. AppKit geometry is in points; persistence remains physical pixels.
Accessories move with the strip and notify React to remeasure their anchors. Global/local mouse
and application-activation observation exists only while the toolbar or its editor is visible;
reports go through React's existing dismissal functions.

## Alternatives

- Collection flags on the existing NSWindow: failed the native full-screen membership probe.
- A vendored Tao Panel constructor: preserves allocation invariants but requires maintaining a
  complete framework source override, including Windows dependency resolution. The maintained
  plugin and validated lifecycle boundaries avoid that fork. Runtime conversion still depends on
  AppKit/framework internals and must be revalidated on dependency upgrades.
- Reparenting WebViews into independent Panels: requires broader framework changes and risks
  command routing, window labels, draft state and lifecycle ownership.
- Recreating shells to toggle full-screen eligibility: worked in isolation but adds ownership
  complexity when public Space membership can gate visibility instead.
- Accessibility or window enumeration for full-screen detection: adds permission dependencies
  unrelated to an overlay. The separate AX reservation service remains opt-in.

## Consequences

The plugin is a community dependency, not a Tauri-supported native constructor. Review its exact
source and licenses on upgrades and repeat the native lifecycle harness. Tao stays unmodified from
crates.io on all platforms; Windows does not depend on or initialize the plugin. Native full-screen Spaces and borderless full-screen windows in a
desktop Space have different semantics: Above Full Screen off gates native Spaces on macOS.

Space membership is an AppKit observation, not a formal full-screen detection API. Single-display
behavior is covered by native integration checks; per-display Spaces and display attachment require
separate hardware acceptance. A delayed notification can take up to the fallback interval to settle.
The ordinary desktop continues to leave room for the menu bar and system Dock. Full-screen content
is overlaid; AX reservation never shrinks a native full-screen application.
