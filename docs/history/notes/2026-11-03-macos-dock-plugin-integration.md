# macOS Dock Plugin Integration

The initial Tao vendor experiment was replaced with the exact-pinned crates.io community plugin
`tauri-nspanel` 2.1.1. There is no Tao source copy, direct Tao dependency or global Cargo override.
The lock retains unmodified Tao 0.37.1; unrelated Windows dependency resolutions were preserved.
The plugin is a macOS target dependency and initialized only on macOS. A Windows-target dependency
query confirms it is absent; this is not a Windows build or runtime acceptance result.

## Lifecycle

The isolated exact-version harness established that immediate conversion while Tao has deferred
style updates can abort inside WebKit KVO. Main enter/exit commands therefore use a serialized
worker on macOS. A task posted after the preceding Tauri messages schedules a main-dispatch callback;
waiting happens only on the worker. Conversion runs after this queue boundary, with no arbitrary
sleep. Boot uses final decorations in the window builder, avoiding a deferred decoration change.
Accessories convert once after their builder has completed and keep the original Tauri delegate.

Exit stops native Space ownership, clears the nonactivating style using the plugin, restores the
original Tao dynamic class, then restores resizability/decorations. After deferred decorations settle,
the actual pre-Dock content/title-bar policy is restored before physical content bounds. This prevents title-bar
height drift. Rollback also stops native ownership before restoring Tao. Other platforms retain
synchronous transition commands. Normal mode does not retain the Panel subclass.

## Evidence

Ignored evidence lives in `artifacts/macos-dock-plugin-validation/` (isolated harness) and
`artifacts/macos-dock-plugin-integration/` (actual PLVS). The first actual-app integration run passed
ten complete Agent Control enter/exit cycles with unchanged 1163 × 790 CSS-pixel geometry.
The 2326 × 1580 normal-window screenshots before/after were byte-identical, SHA-256
`d02b96f730fc9df9faa3605c2824e8a1507f0af1624c05e12e5a643b7c2f7d41`.

In the independent native full-screen host, CUA typed `Plugin fullscreen draft` in the real Dock
panel-name field and saved it through the ordinary UI. Agent Control read that exact custom title
back from React business state. The host's own sample still reported native full screen and active
Space membership. The test cleared the custom name through the normal UI and confirmed the default
was restored. Full-screen off made the main renderer unavailable for screenshots; leaving full screen
restored a successful screenshot. This supports the unchanged native owner's gating; native
`isVisible` assertions were established in the isolated harness, not inferred from frontend inspect.

Window hide/show passed through the existing lifecycle and reported suspended/resumed Dock state.
A real process restart restored enabled Dock with Above Full Screen off, its height/layout and the
original panel title. Persistence acceptance used an app restart, not Vite reload.

## Checks and limits

The full contracts gate passed: licenses, public/docs/website contracts and 6,353 tests in 590 files.
Formatting, ESLint, TypeScript, production frontend build, Rust formatting, workspace/all-target
Clippy with warnings denied, and workspace Rust tests passed (application library: 807 passed,
3 intentionally ignored). No audio capture implementation was changed.

A synthesized CUA background click did not reliably dismiss the shown accessories; it is not a
manual acceptance pass. The earlier physical-mouse test passed with the same native dismissal owner,
but the final plugin build still needs that physical-mouse check. Some Agent Control editor-open
requests over full screen timed out before the surface later appeared; actual toolbar clicks and
keyboard input worked. Treat these timeouts as unresolved automation behavior, not success.
Multiple displays, Windows runtime and long-duration memory stability remain separate acceptance.
No branch, commit, push or release was performed.

The Mac locked during the final decorated-window screenshot attempt; CUA explicitly reported that
it could not unlock the machine. That screenshot is not a pass. The original borderless preference,
Above Full Screen on, normal window form, 1163 × 790 geometry and default panel title were restored
through the ordinary Agent Control business functions and read back. A decorated native-window
round trip passed in the isolated harness; the final decorated PLVS visual check was pending at that point.
Temporary prototype scripts were retired from the source tree into ignored evidence artifacts.

## Unlocked continuation: content-policy correction

After unlocking, a decorated PLVS window exposed a 32 CSS-pixel content-height regression despite
the prior borderless round trips passing. Reapplying the builder's TitleBarStyle::Visible was wrong
for a window whose Borderless setting had been toggled: Tao's decorations setter drops
FullSizeContentView, so normal windows can legitimately have either policy. The adapter now remembers
the actual pre-Dock FullSizeContentView bit and titlebar transparency before changing chrome, keeps
that snapshot through Panel conversion, and restores it only after Tao's queued decorations settle.
It does not impose the builder default. This also covers rollback. Restart acceptance then showed that the normal policy must survive the
process: `macosNormalChrome`, an optional private two-bit field in the existing Dock record, now
retains it. Boot restores this before applying the strip form. It adds no public Agent Control
writable surface or database schema; legacy records without it remain readable. Zero is a meaningful
saved policy, covered alongside all four combinations and omitted legacy metadata by a Rust test.
The normal decoration path's WebView size synchronization is reused after native geometry settles.

The final correction passed workspace/all-target Clippy with warnings denied and 27 focused Rust
Dock-related tests. Both decorated and borderless actual PLVS windows each passed three consecutive
round trips with byte-identical screenshots. A decorated window whose Borderless setting had been
toggled then passed a real process restart from Dock: 1163 × 790 CSS px and byte-identical before/after
screenshots (`persisted-policy-restart.json`). The workspace `state.json` was inspected after restart;
its Dock record retained the meaningful `macosNormalChrome: 0` value.

The user tested the final plugin build with a physical mouse over the black native full-screen host
and confirmed that both toolbar and Views disappeared while the Dock strip stayed visible. This
supersedes the earlier pending physical-mouse acceptance. No simulated click is counted as that pass.
The final full-screen Agent Control toolbar/Views open also settled successfully. The earlier open
timeouts remain recorded as intermittent development automation behavior; they were not reproduced
in that final setup. Multiple displays and Windows runtime still need their respective hardware.
