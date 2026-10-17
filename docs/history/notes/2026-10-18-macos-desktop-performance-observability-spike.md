# macOS desktop-performance observability spike

**Date:** 2026-10-18

**Source:** `ebb440954e9c3e88d9a71f5c1cb2498d6a4ca83e`

**Host:** macOS 15.6.1, Apple Silicon

**Status:** Complete; the shared performance claims are observable, with explicit macOS gaps for
JavaScript heap and per-application GPU attribution

## Question

Can a macOS acceptance adapter observe WKWebView responsiveness, native UI-frame backpressure,
audio drops, recovery and process resources reliably enough to preserve the existing Windows
desktop-performance purpose without using private APIs, administrator access or arbitrary browser
automation?

## Method

The spike first inspected the current Windows-only performance tools and the existing native
`get_ui_frame_diagnostics` command. It then temporarily exposed a development-only frontend probe
through the running application's existing Agent Control inspection path. The probe was removed
after the experiment; no spike code remains in the worktree.

The probe sampled browser capabilities, DOM size, `requestAnimationFrame` progress and native
UI-frame diagnostics in the real WKWebView. It was exercised while foregrounded, while
backgrounded or occluded, and during live capture with a restored multi-panel workspace. A second
run used the optimized dev identity built by `npm run desktop:dev-optimized`, an isolated
application-data root, one workbench, BlackHole 2ch and the repository-owned VLC signal route.

Process discovery used public, non-privileged macOS tools. Host and child processes were sampled
with `ps`. WebKit auxiliary processes were inspected with `lsof` to determine whether their open
paths could attribute them to PLVS.

Cleanup stopped live capture, restored automatic device selection, stopped the exact VLC and PLVS
processes created by the spike, and confirmed that the isolated Agent Control registry was empty.
The temporary application data was moved to Trash.

## Browser and frame findings

WKWebView reported only `mark`, `measure`, `navigation`, `paint` and `resource` as supported
Performance Observer entry types. It did not expose `longtask`, `long-animation-frame` or
`performance.memory`. Those Windows WebView2 signals therefore cannot be mandatory shared fields.

`requestAnimationFrame`, DOM node counting and the native UI-frame diagnostics were available. A
foreground idle sample produced about 62 callbacks over 1,012 ms with a maximum observed gap of
23 ms. When the window was backgrounded or occluded, a callback could remain pending for more than
10 seconds.

A debug-build sample with three restored workbenches and live heavy capture took about 7.6 seconds
to complete a nominal one-second request and observed only one callback. This is not a product
performance result: the build, restored state and sampling method were intentionally uncontrolled.
It does prove that animation-frame age detects a collapsed renderer and that a request must never
wait for the next animation frame to answer.

The macOS frontend adapter should install one continuous probe when the application mounts. A
diagnostic request then returns the latest counters synchronously, including callback count,
maximum gap and age of the latest callback. The runner owns a hard request timeout and treats stale
frame data separately from a responsive low-frame-rate sample.

Native `get_ui_frame_diagnostics` already provides the product-owned backpressure signals:
sent frames, dropped UI frames, audio-dropped frames, current and maximum in-flight work. These
signals are more durable than engine-specific browser telemetry and should form the shared core of
normal, stalled and recovered assertions.

## Process findings

The optimized dev identity launched a PLVS host plus WebKit GPU, WebContent and Networking
processes. A single live-capture sample showed that public tools can read RSS, CPU and cumulative
CPU time. The values are feasibility observations only, not a baseline or release threshold.

WebKit auxiliary processes are reparented to PID 1, so walking the PLVS parent tree does not find
them. The WebContent and Networking processes can be attributed without elevation because they
hold paths below PLVS-owned WebKit storage, such as `Library/Caches/plvs/WebKit` and
`Library/WebKit/plvs/WebsiteData`.

The shared WebKit GPU process exposed no PLVS-specific open path. macOS also did not offer a public
non-root process-coalition field through `ps`; `launchctl procinfo` required administrator access.
Consequently the adapter cannot safely claim per-PLVS GPU CPU or memory when other WebKit
applications may be running. These fields must be reported as unsupported, not zero and not an
estimate.

Formal runs should require one isolated PLVS dev instance and reject unrelated PLVS processes.
They may aggregate the host, its normal children, and auxiliary WebContent or Networking processes
that have positive PLVS path evidence. The process report must name its attribution method and
leave GPU attribution unsupported.

## Adapter decision

The cross-platform desktop-performance runner is feasible with independent adapters and a shared
claim layer:

- Preserve the Windows CDP, PowerShell process-tree, JavaScript heap and long-task implementation
  behind a Windows adapter.
- Add fixed development-only Agent Control operations for a synchronous diagnostic snapshot and a
  bounded main-thread stall. Do not expose arbitrary JavaScript evaluation.
- Include native UI-frame sent/drop/in-flight counters, continuous animation-frame counters and
  freshness, DOM count, and explicit browser capability flags in the normalized snapshot.
- Launch the optimized dev identity with isolated application data, require one instance, and
  confirm that the test surface is foreground and unobscured before timing-sensitive phases.
- Reuse the capture rig and Agent Control device/transport operations for default and heavy live
  scenarios.
- On macOS, sample safely attributable host, child, WebContent and Networking resources. Report
  JavaScript heap, long tasks and per-application GPU resources as unsupported.
- Require cleanup evidence for capture, device restoration, player exit, application exit,
  registry removal and temporary-data handling.

The fixed stall operation makes the normal/stalled/recovered acceptance deterministic. A runner
can snapshot before the stall, issue one bounded stall, verify native backpressure while the
frontend is blocked, and then verify fresh animation frames and stable audio after recovery.

Long default and heavy soaks should compare shared frame-drop, audio-drop, recovery and resource
trend summaries. Platform-only resource fields remain diagnostic and capability-labelled. Missing
macOS JavaScript heap or GPU attribution is not a failed product claim; missing or stale shared
frame/audio evidence is.

## Conclusion

Proceed to design and implementation planning. The common acceptance contract should judge
responsiveness, backpressure, recovery and audio continuity. It should not weaken the existing
Windows observations, and it should not manufacture macOS parity for signals that public WKWebView
and process APIs cannot reliably provide.
