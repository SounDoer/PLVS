# Quick Tour Design

Date: 2026-10-30

Status: Initial implementation in the onboarding worktree, not merged or released. The sequence
and interaction direction are agreed. This record describes the feature under development, not
current released behavior.

## Audience and purpose

Audio professionals using PLVS for the first time. Help them start a real measurement and discover
the main controls. Do not teach audio terminology or require changes to finish the tour.

## Agreed experience

- Ten steps: Start, Sources, Loudness Profile, Modules, Views, Presets, Panel Settings, Snapshot,
  Clear, Settings.
- A small anchored card and a soft target glow; no full-screen scrim or interaction shield.
- Users can operate the application, change settings, and rearrange panels throughout the tour.
- Opening a menu or settings surface hides the tour. The same step returns automatically after
  all menus/editors close and a short quiet interval; there is no Resume Tour control.
- Panel Settings introduces the existing entry point without requiring it to be opened or changed.
- Start and Snapshot recognize actual application state; every step can be continued without
  performing an action. No automatic capture, clearing, source changes, or layout restoration.
- Exit and completion preserve capture, Snapshot selection, configuration, and all user edits.
- Quick Tour is available in the Settings footer alongside Docs and Feedback.

## Presentation and existing design system

Build a new tour behavior component using existing UI primitives and semantic/component tokens.
Reuse the Popover surface treatment (background, text, border, radius, raised shadow), existing
buttons and icon actions, and the existing typography and control-height scales. Supporting copy
uses secondary text, not annotation text. Text containers must grow with Interface Size and fit
within the viewport. Honor reduced motion.

Use an existing accent role for static, soft target emphasis, following the control's corner shape.
The glow has no hard border or interior fill and is lighter around a large history chart.
Keep the treatment distinct from keyboard focus.
Do not introduce a second focus ring or new palette values. No new design tokens are anticipated.
The highlight layer must not intercept pointer input, obscure readings, or change layout geometry.

Cards include a title, short explanation, step count, Back, Next, and Close. The first step omits
Back; the final step uses Finish. Actions and progress labels use existing Title Case conventions;
aria-labels follow the repository's lowercase convention.

The tour is non-modal: no focus trap and no repeated focus stealing as targets move or app state
changes. Provide keyboard access to the card. Automatic return does not move focus. Escape dismisses the active menu
or dialog first; when interacting with the tour, Escape can close the tour. Avoid global keyboard
handlers that consume application shortcuts or interrupt text editing.

## Entry and lifecycle

Proposed invitation title: **Quick Tour**.

Copy: “Start metering and discover the main controls in PLVS.”

Actions: **Start Tour** and **Not Now**. Closing the invitation counts as declining it. Show it after
the first-launch update preference interaction is settled, never over that interaction. Declining,
closing an active tour, and completing it suppress future automatic invitations. Manual replay
remains available. Do not automatically invite established users on upgrade.

Use installation/identity preference persistence for invitation disposition, not a portable Preset.
Persist no audio or measurement data. Reset PLVS to Default may restore the initial invitation.
The exact preference owner and detection of established installations must be resolved against
existing persistence contracts before implementation; absence of the new key alone is insufficient.
Only one eligible workbench should automatically invite; do not repeat the invitation in additional
workbenches. Coordinate through the existing identity-wide settings ownership model.

In Settings, place **Quick Tour** after **Docs** and before **Feedback**, reusing the existing footer
link-style button without an external-link icon. Activating it closes Settings through its normal
path, then starts at step 1 with current app state intact. If an existing editor or guard prevents
the transition, preserve the editor and defer the tour rather than discarding a draft.

Runtime states: inactive, invitation, waiting for explicit launch, active(step), finished/dismissed.
An active step may be temporarily hidden while the application is occupied or unsupported. Active steps
are session state; reopening after a restart need not restore a partially completed tour.

## Step script

Copy is a draft; validate against actual business behavior while implementing.

| Step | Title                | Body                                                                                                                                   | Preferred anchor                 |
| ---- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1    | Start Monitoring     | Play some audio, then click Start to begin metering your selected source. Automatic uses your default system output.                   | Start control                    |
| 2    | Choose Your Source   | Choose a system output, an input device, or a supported application. Automatic follows your default system output.                     | Sources                          |
| 3    | Loudness Profile     | Choose reference lines and warning thresholds for your session. Edit a profile to match your requirements.                             | Loudness Profile                 |
| 4    | Manage Your Panels   | Add, rename, or remove panels. Add multiple instances to view the same meter in different ways.                                        | Modules                          |
| 5    | Adjust Your View     | Keep PLVS on top, simplify the interface, or adjust transparency.                                                                      | Views                            |
| 6    | Save Your Workspace  | Save your layout and configuration as a Preset, then switch between setups for different tasks.                                        | Presets                          |
| 7    | Panel Settings       | Each panel has its own settings. Open this menu to adjust its analysis and display options.                                            | A visible panel settings control |
| 8    | Inspect a Moment     | Click a history chart to inspect that moment across all meters. Live capture continues in the background.                              | A visible history chart          |
| 9    | Clear Measurement    | Clear resets the current measurement data so you can begin a fresh measurement. You don't need to clear anything to continue the tour. | Clear                            |
| 10   | Application Settings | Open Settings for application preferences. Quick Tour is at the bottom if you'd like to view this guide again.                         | Settings                         |

On platforms with Dock, append to Views: “Use Dock for a slim meter strip at the screen edge.”
On Linux, omit that sentence. Sources wording must reflect platform-supported choices.

### Start

- Observe confirmed lifecycle state; a click alone does not mean capture succeeded.
- If already running or once startup succeeds, keep the card in place and replace the body with
  “Metering is running. You can stop it at any time using the same button.” Do not auto-advance.
- Silence does not block Next. If a no-signal hint is shown, use real signal state and distinguish
  silence from unavailable metrics or startup. Do not invent an error from a short delay.
- Startup failures stay visible through existing error/status behavior. Offer a route to Sources;
  opening it pauses the tour. Next remains available.

### Snapshot

- Prefer a visible chart that supports history selection; do not assume an arbitrary meter does.
- If history is unavailable, explain that selection becomes available after measurement history
  accumulates. Do not wait, generate data, or start capture on behalf of the user.
- Once a Snapshot is selected, point to the actual Return to Live control and use:
  “You're viewing a Snapshot. Click here to return to live readings.”
- Returning to Live restores the chart explanation. Both directions remain within step 8 and
  require Next to proceed. If already in Snapshot on entry, show the return explanation immediately.

## Pausing and positioning

Use stable semantic target registrations/identifiers and live element bounds, never saved screen
coordinates, translated text matching, or fragile DOM child indices. Reuse existing positioning
facilities where suitable. Clamp/flip placement within the viewport and avoid covering the target.

Moving/resizing a panel, resizing the window, and changing Interface Size update the anchor and card
position. During an active drag or resize, the card may collapse to avoid interference, then return
without fighting the user's pointer.

Opening a menu, editor, or Settings removes the glow/card without changing the current step.
After all surfaces close, wait for a 180 ms quiet interval and return automatically, re-evaluating
the current state and target. Opening an editor from a menu restarts that interval, so the card
does not flash between the two. Return never advances the step, takes keyboard focus, closes a
surface, or cancels a draft. Explicitly exiting the tour prevents any later automatic return.

Distinguish moved targets from missing targets:

- Moved target: follow its actual bounds.
- Deleted panel: select another visible eligible panel, keeping that choice stable until invalid.
- All panel headers hidden: explain that Panel Settings is available when headers are shown via
  Views; show a viewport-positioned informational card with navigation, without changing Views.
- No eligible history chart: explain the history-panel prerequisite and allow Next.
- Other missing targets: show an informative fallback card instead of a floating orphan highlight.

Proposed v1 scope is the normal Live workspace. Entering Dock or File mode hides the tour; it returns
automatically on returning to the normal Live workspace. Do not automatically exit Dock,
switch mode, or introduce extra cross-window tour infrastructure in v1.

## Validation and implementation follow-through

- Test invitation suppression for accepted, declined, dismissed, completed, and established-user
  cases, including additional workbenches and app restart persistence.
- Test Back/Next/Finish and manual replay without starting capture or changing any app settings.
- Test confirmed Start state, errors, silence, pre-existing capture, and pre-existing Snapshot.
- Test pause/resume around real menus and blocking editors, preserving all drafts and edits.
- Test target replacement and missing-target fallbacks without restoring or mutating layout.
- Verify real desktop screenshots for anchoring, clipping, multiple Interface Sizes, light/dark
  themes, panel movement, keyboard access, and unobstructed controls. Use Agent Control for supported
  state inspection and screenshot capture; follow its contract if the tour adds a navigable surface.
- Use existing persistence domains and normal business functions; never mutate engine/store state
  to simulate progress. The tour itself has no draft/preview/save/cancel editor semantics and must
  not register as a blocking editor. Existing blocking editors retain all their protections.
- Update the relevant user-guide chapters when functionality is implemented. Keep this design in
  history rather than treating it as current product documentation.
- Run focused behavior tests during implementation and the scope-selected gate before any push or
  merge, following repository workflow.

## References

- [Intercom Product Tours](https://www.intercom.com/help/en/articles/2900885-product-tours-explained):
  examples of advancing by explanation or actual interaction and allowing later replay.
- [NN/g: Onboarding Tutorials vs. Contextual Help](https://www.nngroup.com/articles/onboarding-tutorials/):
  reasons to keep explanations contextual, optional, and available when needed.

These references inform interaction choices; they do not imply adding a third-party onboarding
service, telemetry, or network dependency to PLVS.

## Implementation notes and privacy review

The identity-wide `quickTour` preference records only pending/started/dismissed/completed status.
Fresh native storage seeds pending atomically; existing storage without the preference is marked
dismissed, including legacy migration. Hydration and peer refresh project it into the settings
domain; workspace persistence excludes it. Reset restores pending. No step history, usage counter,
audio, measurements, or user identifier is collected. There is no new network path or provider;
existing local-settings policy remains applicable and no policy wording/date change is needed.

The tour is an internal, non-modal help region rather than a new Agent Control navigable surface.
It does not expand the public CLI or patch protocol. Its real controls remain reachable through
existing business paths. UI testing exercises the help controls themselves and uses existing
Agent Control inspection/capture for desktop review.

### Validation on 2026-10-30

- 264 related frontend tests passed across 13 files, including tour behavior, Settings entry,
  application smoke tests, panel/header integration, persistence, design contracts, and documentation.
  A subsequent startup-order refinement passed the 45 affected tour/application smoke tests.
- 25 focused Rust tests passed: bootstrap (4), storage/bootstrap/hydration/session integration (10),
  and configuration profile behavior (11). Native compilation needed single-job execution after
  Windows reported paging-file exhaustion during the initial parallel build.
- Frontend type checking, lint, production build, changed-file formatting, Rust formatting, and
  diff whitespace checks passed during implementation.
- Windows desktop review exercised the real Start control, opening Sources and explicit resume,
  all nine steps, Panel Settings highlighting, history-click Snapshot entry and Return to Live
  guidance, and completion without clearing the Snapshot or stopping capture.
- Light/Dark and Extra Large interface sizing were reviewed. Agent Control screenshots are under
  ignored `artifacts/onboarding-review/`, including `profile.png`, `panel-settings.png`,
  `snapshot.png`, `light-extra-large.png`, and `finish-light-extra-large.png`.
- After completion, the test process exited and its local SQLite preference was read as
  `completed`. Relaunching the same isolated test identity showed no automatic tour. This check
  used a real process restart, not HMR. An upgraded-user fixture with update requests disabled was
  used for manual UI review; fresh-install invitation and update-setup ordering are covered by
  focused tests. No update-consent UI was automated.
- Mac/Linux native visuals and physical-device capture acceptance were not run. This change does
  not modify the capture layer. No push, merge, or stable-release gate was performed.

### Feedback revision on 2026-10-30

Replaced the outline with a static accent glow, separated Clear and Settings into steps 9 and 10,
and removed manual resume. Tests cover automatic return to the same step without focus changes,
transparent opening/closing surfaces, nested-editor handoffs without flashes, explicit dismissal,
and independent final controls. The 36 tour/design-contract tests and 109 application/Settings/
documentation tests passed; the final transparent-surface refinement passed all 15 tour tests.
Type checking, focused lint, formatting, and the production Vite build passed. Windows review
verified the glow and automatic return after closing Sources, plus Light/Extra Large presentation.
Review captures include `artifacts/onboarding-review/glow-start.png` and `auto-return.png`.
