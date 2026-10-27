# Dock Sharesets paste implementation plan

Date: 2026-10-27

Goal: implement `docs/history/specs/2026-10-27-dock-sharesets-paste-design.md` while preserving the existing import contract and avoiding a new Paste control.

## 1. Establish shared ownership and input routing

- Extract the paste-event filtering into a small shared helper, preserving editable targets and the ordinary window behavior. Mount the main listener above the Dock/normal conditional, with a single `usePackTransfer` owner.
- Forward native paste event text from the Dock header and editor through the accessory event protocol to main; validate the sender, accept only while Dock is active, and avoid duplicate handling. Do not read the clipboard proactively or log its contents. Handle busy and already-open review/completion explicitly so a second gesture cannot replace pending work.
- Add focused tests for normal and Dock routing, editable targets, inactive surfaces, duplicate events and pending imports. Retain existing transfer tests.

## 2. Extract reusable import presentation

- Separate the review/completion content and actions from the ordinary `ItemPickerDialog` shell, retaining its accessibility, dispositions, dependency rows, warnings and optional completion action. Share the action implementation and existing business guards with Dock rather than reimplementing library writes in the accessory.
- Provide a Dock-compatible error/status presentation and an explicit close path. Test cancellation, confirm-once, duplicate items, warnings and completion action refusal with no unintended mutation.

## 3. Add Dock import accessory

- Add the `dock-import` surface to the frontend protocol, routing, document setup, native capability and native window creation/hide lifecycle. Follow `useDockUpdateWindow` for readiness, measured size, theme and interface-size publication, focus and edge-aware placement, with separate state and action identities.
- Integrate geometry and focus with Dock accessory visibility. Define and test deterministic update/import ordering without discarding either pending surface or any editor draft. Ensure exit and suspension hide the surface and re-entry reconciles state.
- On window creation, handshake, delivery or display failure, keep pending import state and use the established Dock restore path to present it in the ordinary window. Test failure and recovery, including an error during completion.
- Extend focused frontend, protocol, capability and native geometry/lifecycle tests. Do not hand-edit generated files.

## 4. Document and validate

- Update `docs/user/system-settings.md` with the Dock focus requirement and shortcut; reconcile the broad claim that paste works anywhere outside a text field.
- Run focused Vitest and Rust tests covering touched code, followed by the appropriate repository checks for the completed scope. Do not claim native keyboard behavior from synthetic events alone.
- With a running Tauri app, validate real paste gestures and the spec's Windows and macOS scenarios. Capture and inspect before/after Agent Control screenshots for Dock visual changes, including long content and both edges. Record unavailable platform or hardware coverage explicitly.
