# macOS Dock implementation

Work is authorized on main; the user explicitly declined an isolated worktree.

The native and Tauri integration probes passed core single-display behavior, including manual
outside-click dismissal and normal-window restoration. Formal implementation must remove the
temporary Cargo override, dev-only switch and debug telemetry from the shipping path.

1. Use macOS-only exact-pinned `tauri-nspanel` 2.1.1. Remove the initial vendored Tao experiment
   and its global override. Preserve the original Tauri delegate and WebView. Drain deferred style
   changes before class conversion, and restore normal chrome before physical bounds.
2. Replace the opt-in probe with a macOS Dock-window owner. Keep one React runtime and the same
   Tauri window/WebView identities. Keep outside interaction observation limited to shown
   accessories and reuse React's existing dismissal business functions.
3. Implement Above Full Screen with a transparent, noninteractive ordinary NSWindow that joins
   desktop Spaces but not native full-screen Spaces. Its public `onActiveSpace` property is a
   per-display signal; single-display native experiments verified false in full screen and true
   after leaving it. Hide/show Panels instead of recreating WebViews. Validate multi-display
   behavior separately; do not infer it from one display or use AX/screen-recording permission.
4. Reconcile native geometry on Space/display changes: ordinary desktop work area, full-screen
   edge with notch-safe top inset. Respect suspend/resume, boot, monitor moves, resize, exit and
   accessory visibility. Update the existing UI and Agent Control support declaration together.
5. Add an ADR for the constructor/Space choices; update architecture, user guide, FAQ and native
   maintenance notes. Retain history records as experimental evidence, not current behavior.
6. Run focused contracts/native tests and actual Agent Control screenshot comparisons. Exercise
   toggles on/off over a full-screen host, ordinary mode, restart and existing AX avoidance.
   Broader platform checks must be reported with their real evidence; no capture-layer changes
   are planned. Before a push, run `check:changes` after the final commit as repository rules require.

Plugin replacement is implemented on main. The Tao vendor tree/global override and temporary
prototype scripts were removed. Full contracts/frontend/native checks passed, alongside ten actual
PLVS cycles with byte-identical normal screenshots, real full-screen editor keyboard/save behavior,
suspend/resume and restart. Unlocked continuation fixed title-bar/content-policy drift and verified
both window modes plus a decorated Dock process restart with byte-identical screenshots. The user
confirmed physical background-click dismissal with the strip retained. Multi-display and Windows runtime acceptance require their respective machines.
See the dated plugin integration note for precise evidence and limits. No commit, push, release or
branch change was performed.
