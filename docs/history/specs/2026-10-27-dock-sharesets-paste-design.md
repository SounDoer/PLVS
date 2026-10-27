# Dock Sharesets paste design

Date: 2026-10-27

## Goal

Allow a user to copy a Theme, Preset, or Loudness Profile from Sharesets and paste it into a focused Dock with Ctrl+V on Windows or Command+V on macOS. Present the existing import review without leaving Dock. Do not add a Paste button or a global OS shortcut.

## Current behavior and scope

The main application's `usePackTransfer` owns parsing, import planning, confirmation and completion. `AppSettingsOverlays` currently owns the window paste listener and the normal review dialog, but `AppShell` does not mount it in Dock. The Dock strip, toolbar, editor and update window are separate WebViews. Dock intentionally keeps normal overlays out of the narrow strip; this design adds a separate surface using the same model as the Dock update accessory.

This covers any clipboard text accepted by the existing import parser, not only Sharesets. It does not change portable formats, merge rules, or import from files.

## Interaction

- A paste event in the focused Dock strip, toolbar, or editor is forwarded to the main application. Handle the native `paste` event and its `text/plain` data, not a global shortcut or unsolicited clipboard reads. Text inputs, textareas and editable content retain their normal paste behavior. Focus must actually belong to PLVS; switching from a browser requires focusing Dock first.
- The main application invokes the existing `beginPaste` once. Parse and plan in the main application; accessory WebViews never write libraries directly. A valid item opens review in an independent Dock import accessory. The review includes the same item dispositions, bundled profiles and adaptation warnings as the ordinary dialog. Nothing is added or applied until the user confirms.
- Confirm runs the existing import action once and shows completion, with the same optional follow-up action and safety guards as normal mode. Cancel and Escape close review without mutation. Closing completion does not undo an import. Errors and unrelated text produce visible feedback in Dock, consistent with the existing normal-mode status; a user can dismiss it. Never log clipboard content.
- A review or completion already open is not silently replaced by another paste. Ignore or visibly refuse the new request until the current operation is closed. Preserve existing editor drafts and scene-operation guards. Do not treat the import review as a new draft editor.
- Normal mode keeps its current behavior. While the import accessory is focused, editable fields retain normal paste behavior; additional paste must not replace the pending review. Do not intercept typing in the update accessory.

## Window and ownership

Create a distinct `dock-import` accessory, following the update accessory's on-demand creation, state publication, readiness handshake, theme and interface-size synchronization, content measurement, monitor-aware geometry, focus and hide lifecycle. Keep import state and actions in the main React application; send only the presentation data required by the accessory, and validate surface, action and current presentation identity before acting. Extract shared review/completion content where practical so ordinary and Dock surfaces cannot drift. Do not mount the ordinary modal unchanged inside a tiny WebView if its portal, focus trap or layout assumes the main window.

The import window must coexist safely with the update and editor accessories: it must not overwrite their state or discard drafts. Define an explicit presentation priority for overlapping update and import surfaces; preserve both pending states and make the obscured surface available again when the foreground surface closes. Integrate import geometry and focus into existing accessory visibility and pointer handling, and hide it on Dock exit or suspension. Position it within the current monitor for either Dock edge and interface scale, with scrollable content for long reviews.

On accessory creation, readiness, event delivery or display failure, preserve the parsed review or completion and exit Dock through the existing restore path so the ordinary dialog can present it. Never confirm or cancel automatically on failure. A failed parse should show feedback without a library change. If fallback itself fails, report the failure visibly where possible and preserve pending state.

## Verification and acceptance

Unit and integration coverage must exercise focused main and accessory paste delivery, editable targets, one delivery per gesture, stale or duplicate actions, busy/pending review behavior, invalid text, cancellation without writes, confirmation and completion actions, and fallback with state preserved. Cover independent update/editor coexistence, readiness, resizing and lifecycle. Verify capabilities and native command ownership for the new surface. Existing import contract tests must remain valid.

On Windows and macOS with the running Tauri app, copy actual Sharesets resources in a browser, focus each Dock surface, paste and complete or cancel the flow. Exercise both Dock edges, a long review, multiple interface scales, invalid text, a focused text field, an open editor draft, and an update waiting at the same time. Compare Agent Control screenshots before and after for the affected Dock rendering and inspect the accessory at representative sizes. Confirm the app does not intercept paste in another application. Update the user guide to describe Dock focus and the shortcut.
