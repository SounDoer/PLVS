# First-Run Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a new PLVS user's first launch match the hand-tuned defaults in
`docs/superpowers/specs/2026-09-14-first-run-defaults-design.md`: a 1280×800 logical window fitted
to the primary monitor, the tuned workspace layout and panel settings, the starter Loudness Profile
active, and the tuned Dock form, panels, widths and settings.

**Architecture:** Window placement becomes one pure Rust rule (`default_window_bounds`) used by
first launch, the saved-bounds fallback and Dock exit. Every frontend default stays where it lives
today (`workspace/constants.js`, `loudnessProfileNormalize.js`, `dockSizing.js`, `useDockMode.js`,
`dockLayout.js`, `dockModuleControls.js`); first-run values are layered on top of the existing
module defaults so a panel the user adds later keeps today's defaults.

**Tech Stack:** Rust (Tauri 2.11, tao 0.35), React 19, Vitest (jsdom), `cargo test`.

---

## Ground rules for every task

- Work on `main`; commits use Conventional Commits with a scope and end with
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Do not start a commit subject with `@`.
- Frontend tests: `npx vitest run <path>`. React tests already carry
  `/** @vitest-environment jsdom */`.
- Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml <filter>`.
- **`cargo test` and `npm run check` rebuild `src-tauri/target/debug/plvs.exe` without the
  `dev-identity` feature**, which breaks `npm run desktop:control` (`cliHostIdentityMismatch`).
  Before using `desktop:control` after either, run:
  `cargo build --manifest-path src-tauri/Cargo.toml --bin plvs --features dev-identity`.
- Kill PLVS processes by PID, never by image name (that also kills the installed release app).

## File map

| File | Responsibility | Task |
| --- | --- | --- |
| `src-tauri/src/window_state.rs` | Pure placement rule `default_window_bounds`, `FitTarget`, `primary_fit_target`, `clamp_to_visible` fallback | 1 |
| `src-tauri/src/lib.rs` | First-launch size and placement | 1 |
| `src-tauri/src/dock.rs` | Dock exit restores normal bounds with the same rule; default Dock height | 1, 4 |
| `src/workspace/constants.js` | First-run tree, panels and per-panel controls | 2 |
| `src/lib/loudnessProfileNormalize.js` | Starter profile selected on cold seed | 3 |
| `src/dock/dockSizing.js`, `src/hooks/useDockMode.js` | First-run Dock height and edge | 4 |
| `src/dock/dockLayout.js`, `src/dock/dockModuleControls.js`, `src/dock/useDockLayout.js` | First-run Dock modules, widths and controls; Reset Layout | 5 |
| (verification only) | `npm run check`, fresh-profile check through Agent Control | 6 |

---

### Task 1: Window size and fit (Rust)

**Files:**
- Modify: `src-tauri/src/window_state.rs` (constants at lines 70–74, `centered_on_monitor` at 83–96, `clamp_to_visible` at 109–128, `apply_window_bounds` at 170–175, tests module)
- Modify: `src-tauri/src/lib.rs` (import at 43–46, `inner_size` at 232, saved-bounds restore at 271–291)
- Modify: `src-tauri/src/dock.rs` (import at 8–10, `exit_dock` restore at ~484–515)

- [ ] **Step 1: Write the failing tests**

In `src-tauri/src/window_state.rs`, inside `mod tests`, replace the helper `fn mon()` block and the
five tests `keeps_a_fully_visible_window`, `recenters_a_window_on_a_gone_monitor`,
`empty_monitor_list_is_a_noop`, `clamp_preserves_maximized_flag`,
`recenters_minimized_windows_sentinel_bounds` with:

```rust
  fn mon() -> Vec<MonitorRect> {
    vec![MonitorRect {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    }]
  }

  fn target() -> FitTarget {
    FitTarget {
      work_area: mon()[0],
      scale: 1.0,
      frame_width: 0,
      frame_height: 0,
    }
  }

  #[test]
  fn keeps_a_fully_visible_window() {
    let b = WindowBounds {
      x: 100,
      y: 100,
      width: 1280,
      height: 800,
      is_maximized: false,
    };
    assert_eq!(clamp_to_visible(b, &mon(), target()), b);
  }

  #[test]
  fn replaces_a_window_on_a_gone_monitor_with_the_default_window() {
    let b = WindowBounds {
      x: 5000,
      y: 5000,
      width: 1800,
      height: 1000,
      is_maximized: false,
    };
    let c = clamp_to_visible(b, &mon(), target());
    assert_eq!((c.width, c.height), (1280, 800));
    assert_eq!((c.x, c.y), ((1920 - 1280) / 2, (1080 - 800) / 2));
  }

  #[test]
  fn empty_monitor_list_is_a_noop() {
    let b = WindowBounds {
      x: 100,
      y: 100,
      width: 1280,
      height: 800,
      is_maximized: false,
    };
    assert_eq!(clamp_to_visible(b, &[], target()), b);
  }

  #[test]
  fn clamp_preserves_maximized_flag() {
    let b = WindowBounds {
      x: 5000,
      y: 5000,
      width: 1280,
      height: 800,
      is_maximized: true,
    };
    let c = clamp_to_visible(b, &mon(), target());
    assert!(c.is_maximized);
    assert_eq!((c.width, c.height), (1280, 800));
  }

  #[test]
  fn replaces_minimized_windows_sentinel_bounds_with_the_default_window() {
    let b = WindowBounds {
      x: -32000,
      y: -32000,
      width: 0,
      height: 0,
      is_maximized: false,
    };
    let c = clamp_to_visible(b, &mon(), target());
    assert_eq!((c.width, c.height), (1280, 800));
    assert_eq!((c.x, c.y), ((1920 - 1280) / 2, (1080 - 800) / 2));
  }

  #[test]
  fn default_window_is_1280_by_800_logical_centered_when_it_fits() {
    // 2560x1440 at 125% with a 60 px taskbar; chrome is 16 x 40 physical.
    let t = FitTarget {
      work_area: MonitorRect {
        x: 0,
        y: 0,
        width: 2560,
        height: 1380,
      },
      scale: 1.25,
      frame_width: 16,
      frame_height: 40,
    };
    assert_eq!(
      default_window_bounds(t),
      WindowBounds {
        x: 472,
        y: 170,
        width: 1600,
        height: 1000,
        is_maximized: false,
      }
    );
  }

  #[test]
  fn default_window_shrinks_proportionally_into_90_percent_of_the_work_area() {
    // 1920x1080 at 125% with a 48 px taskbar: a 1536x826 logical work area.
    let t = FitTarget {
      work_area: MonitorRect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1032,
      },
      scale: 1.25,
      frame_width: 16,
      frame_height: 40,
    };
    let b = default_window_bounds(t);
    assert_eq!((b.width, b.height), (1422, 888));
    assert!(b.width + 16 <= 1728 && b.height + 40 <= 929);
    assert_eq!((b.x, b.y), (241, 52));
  }

  #[test]
  fn default_window_centers_in_a_work_area_away_from_the_origin() {
    let t = FitTarget {
      work_area: MonitorRect {
        x: -1920,
        y: 40,
        width: 1920,
        height: 1040,
      },
      scale: 1.0,
      frame_width: 0,
      frame_height: 0,
    };
    assert_eq!(
      default_window_bounds(t),
      WindowBounds {
        x: -1600,
        y: 160,
        width: 1280,
        height: 800,
        is_maximized: false,
      }
    );
  }

  #[test]
  fn default_window_treats_an_invalid_scale_as_one() {
    let t = FitTarget {
      work_area: MonitorRect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      },
      scale: 0.0,
      frame_width: 0,
      frame_height: 0,
    };
    let b = default_window_bounds(t);
    assert_eq!((b.width, b.height), (1280, 800));
  }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml window_state`
Expected: compile errors — `cannot find type FitTarget`, `cannot find function default_window_bounds`, and `clamp_to_visible` takes 2 arguments but 3 were supplied.

- [ ] **Step 3: Implement the placement rule in `window_state.rs`**

Replace lines 70–74 (the five constants starting `const DEFAULT_RESTORED_WIDTH`) with:

```rust
/// First-run content size in logical px; the physical size comes from the target monitor's scale.
pub const DEFAULT_WINDOW_LOGICAL_WIDTH: f64 = 1280.0;
pub const DEFAULT_WINDOW_LOGICAL_HEIGHT: f64 = 800.0;
/// A default-sized window's outer size stays within this share of the work area in each dimension,
/// so a shrunk window keeps a margin and still reads as a normal window.
const WORK_AREA_FIT_FRACTION: f64 = 0.9;
const MIN_RESTORED_WIDTH: u32 = 320;
const MIN_RESTORED_HEIGHT: u32 = 240;
const WINDOWS_MINIMIZED_SENTINEL: i32 = -32000;

/// Where a default-sized window goes: a monitor's work area and scale factor, plus the window chrome
/// (outer minus inner size) that the stored content size does not include. All in physical px.
#[derive(Debug, Clone, Copy)]
pub struct FitTarget {
  pub work_area: MonitorRect,
  pub scale: f64,
  pub frame_width: u32,
  pub frame_height: u32,
}
```

Replace the whole `centered_on_monitor` function (lines 83–96) with:

```rust
/// The first-run window: 1280×800 logical content when it fits within 90% of the work area,
/// otherwise shrunk proportionally (16:10 kept) until it does, centered in the work area.
pub fn default_window_bounds(target: FitTarget) -> WindowBounds {
  let scale = if target.scale.is_finite() && target.scale > 0.0 {
    target.scale
  } else {
    1.0
  };
  let content_width = DEFAULT_WINDOW_LOGICAL_WIDTH * scale;
  let content_height = DEFAULT_WINDOW_LOGICAL_HEIGHT * scale;
  let budget_width =
    (target.work_area.width as f64 * WORK_AREA_FIT_FRACTION - target.frame_width as f64).max(0.0);
  let budget_height = (target.work_area.height as f64 * WORK_AREA_FIT_FRACTION
    - target.frame_height as f64)
    .max(0.0);
  let ratio = (budget_width / content_width)
    .min(budget_height / content_height)
    .min(1.0);
  let width = ((content_width * ratio).floor() as u32).max(MIN_RESTORED_WIDTH);
  let height = ((content_height * ratio).floor() as u32).max(MIN_RESTORED_HEIGHT);
  let outer_width = width as i32 + target.frame_width as i32;
  let outer_height = height as i32 + target.frame_height as i32;
  let area = target.work_area;
  WindowBounds {
    x: area.x + ((area.width as i32 - outer_width) / 2).max(0),
    y: area.y + ((area.height as i32 - outer_height) / 2).max(0),
    width,
    height,
    is_maximized: false,
  }
}
```

Replace the whole `clamp_to_visible` function and its doc comment (lines 107–128) with:

```rust
/// Saved bounds that are unusable (minimized sentinel, degenerate size) or mostly off-screen (less
/// than 1/8 of the window visible on any monitor) are replaced by the default window placed on
/// `fallback`, keeping only the maximized flag. Anything else is returned unchanged.
pub fn clamp_to_visible(
  b: WindowBounds,
  monitors: &[MonitorRect],
  fallback: FitTarget,
) -> WindowBounds {
  if monitors.is_empty() {
    return b;
  }
  if !is_unusable_bounds(&b) {
    let area = b.width as i64 * b.height as i64;
    let visible = monitors
      .iter()
      .map(|m| overlap_area(&b, m))
      .max()
      .unwrap_or(0);
    if visible * 8 >= area {
      return b;
    }
  }
  WindowBounds {
    is_maximized: b.is_maximized,
    ..default_window_bounds(fallback)
  }
}

/// Placement inputs for a default-sized window on the primary monitor (the first monitor when none
/// is reported as primary), including this window's current chrome.
pub fn primary_fit_target<R: tauri::Runtime>(
  window: &tauri::WebviewWindow<R>,
  monitors: &[MonitorRect],
) -> FitTarget {
  let (frame_width, frame_height) = match (window.outer_size(), window.inner_size()) {
    (Ok(outer), Ok(inner)) => (
      outer.width.saturating_sub(inner.width),
      outer.height.saturating_sub(inner.height),
    ),
    _ => (0, 0),
  };
  let primary = window.primary_monitor().ok().flatten().or_else(|| {
    window
      .available_monitors()
      .ok()
      .and_then(|all| all.into_iter().next())
  });
  match primary {
    Some(monitor) => {
      let work_area = monitor.work_area();
      FitTarget {
        work_area: MonitorRect {
          x: work_area.position.x,
          y: work_area.position.y,
          width: work_area.size.width,
          height: work_area.size.height,
        },
        scale: monitor.scale_factor(),
        frame_width,
        frame_height,
      }
    }
    None => FitTarget {
      work_area: monitors.first().copied().unwrap_or(MonitorRect {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      }),
      scale: window.scale_factor().unwrap_or(1.0),
      frame_width,
      frame_height,
    },
  }
}
```

In `apply_window_bounds`, replace:

```rust
  let monitors = monitor_rects(&window);
  let clamped = clamp_to_visible(bounds, &monitors);
```

with:

```rust
  let monitors = monitor_rects(&window);
  let clamped = clamp_to_visible(bounds, &monitors, primary_fit_target(&window, &monitors));
```

- [ ] **Step 4: Use the rule at first launch in `lib.rs`**

Replace the import at lines 43–46:

```rust
use crate::window_state::{
  clamp_to_visible, clean_active_preset_window_bounds, startup_window_is_frameless, MonitorRect,
  WindowBounds,
};
```

with:

```rust
use crate::window_state::{
  clamp_to_visible, clean_active_preset_window_bounds, default_window_bounds, primary_fit_target,
  startup_window_is_frameless, MonitorRect, WindowBounds, DEFAULT_WINDOW_LOGICAL_HEIGHT,
  DEFAULT_WINDOW_LOGICAL_WIDTH,
};
```

Replace `        .inner_size(1280.0, 960.0)` with
`        .inner_size(DEFAULT_WINDOW_LOGICAL_WIDTH, DEFAULT_WINDOW_LOGICAL_HEIGHT)`.

Replace the block that starts `      if restore_normal {` and ends with its closing brace just before
`      let _ = window.show();`:

```rust
      if restore_normal {
        if let Some(b) = saved_bounds {
          let monitors: Vec<MonitorRect> = window
            .available_monitors()
            .unwrap_or_default()
            .iter()
            .map(|m| MonitorRect {
              x: m.position().x,
              y: m.position().y,
              width: m.size().width,
              height: m.size().height,
            })
            .collect();
          let clamped = clamp_to_visible(b, &monitors);
          let _ = window.set_size(tauri::PhysicalSize::new(clamped.width, clamped.height));
          let _ = window.set_position(tauri::PhysicalPosition::new(clamped.x, clamped.y));
          if b.is_maximized {
            let _ = window.maximize();
          }
        }
      }
```

with:

```rust
      if restore_normal {
        let monitors: Vec<MonitorRect> = window
          .available_monitors()
          .unwrap_or_default()
          .iter()
          .map(|m| MonitorRect {
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
          })
          .collect();
        let fit = primary_fit_target(&window, &monitors);
        if let Some(b) = saved_bounds {
          let clamped = clamp_to_visible(b, &monitors, fit);
          let _ = window.set_size(tauri::PhysicalSize::new(clamped.width, clamped.height));
          let _ = window.set_position(tauri::PhysicalPosition::new(clamped.x, clamped.y));
          if b.is_maximized {
            let _ = window.maximize();
          }
        } else if !monitors.is_empty() {
          // First launch: nothing saved, so apply the first-run rule instead of leaving placement to
          // the OS, which cascades from the top-left on Windows.
          let placed = default_window_bounds(fit);
          let _ = window.set_size(tauri::PhysicalSize::new(placed.width, placed.height));
          let _ = window.set_position(tauri::PhysicalPosition::new(placed.x, placed.y));
        }
      }
```

- [ ] **Step 5: Use the rule on Dock exit in `dock.rs`**

Replace the import at lines 8–10:

```rust
use crate::window_state::{
  centered_on_monitor, clamp_to_visible, save_window_bounds, MonitorRect, WindowBounds,
};
```

with:

```rust
use crate::window_state::{
  clamp_to_visible, default_window_bounds, primary_fit_target, save_window_bounds, MonitorRect,
  WindowBounds,
};
```

In `exit_dock`, replace:

```rust
  if let Some(b) = saved {
    let clamped = clamp_to_visible(b, &monitors);
```

with:

```rust
  let fit = primary_fit_target(&window, &monitors);
  if let Some(b) = saved {
    let clamped = clamp_to_visible(b, &monitors, fit);
```

and replace:

```rust
  } else if let Some(m) = monitors.first() {
    // No saved normal bounds (e.g. first run docked): don't leave the window
    // strip-sized — fall back to a default-sized window centered on a monitor.
    let fallback = centered_on_monitor(
      WindowBounds {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        is_maximized: false,
      },
      *m,
    );
```

with:

```rust
  } else if !monitors.is_empty() {
    // No saved normal bounds (e.g. first run docked): don't leave the window strip-sized; place the
    // default window by the first-run rule.
    let fallback = default_window_bounds(fit);
```

(The two `set_size` / `set_position` lines that use `fallback` stay as they are.)

- [ ] **Step 6: Run the Rust tests and lints**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml --all`
Run: `cargo test --manifest-path src-tauri/Cargo.toml window_state`
Expected: all `window_state::tests` pass, including the four new `default_window_*` tests.
Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --workspace --all-targets -- -D warnings`
Expected: no warnings (in particular no unused `WindowBounds` import in `dock.rs` — it is still used by `exit_dock`'s `bounds` parameter).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/window_state.rs src-tauri/src/lib.rs src-tauri/src/dock.rs
git commit -m "feat(window): open at 1280x800 logical, fitted and centered on the primary monitor" -m "First launch no longer leaves placement to the OS. The window is 1280x800 logical when its outer size fits within 90% of the primary monitor's work area, otherwise it shrinks proportionally, and it is centered in the work area. The saved-bounds fallback and Dock exit use the same rule instead of a hard-coded 1280x860 physical size on the first monitor." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: First-run workspace layout and panel settings

**Files:**
- Modify: `src/workspace/constants.js`
- Test: `src/workspace/constants.test.js`, `src/agentControl/panelAnalysis.test.js`

- [ ] **Step 1: Write the failing tests**

In `src/workspace/constants.test.js`, replace the import lines at the top:

```js
import { describe, it, expect } from "vitest";
import { DEFAULT_PANELS_BY_ID, DEFAULT_WORKSPACE_STATE, ALL_MODULE_IDS } from "./constants.js";
import { MODULE_REGISTRY } from "./registry.jsx";
import { MODULE_CATALOG } from "./moduleCatalog.js";
```

with:

```js
import { describe, it, expect } from "vitest";
import { DEFAULT_PANELS_BY_ID, DEFAULT_WORKSPACE_STATE, ALL_MODULE_IDS } from "./constants.js";
import { MODULE_REGISTRY } from "./registry.jsx";
import { MODULE_CATALOG } from "./moduleCatalog.js";
import { DEFAULT_PANEL_CONTROLS, normalizePanelControls } from "../lib/panelControls.js";
import { STATS_CANONICAL_ORDER } from "../lib/statsCatalog.js";
```

Replace the test `it("does not join the default module set or the default workspace", ...)` (the
last test in the file) with:

```js
  it("joins the default workspace but not the default module set", () => {
    expect(ALL_MODULE_IDS).not.toContain("stereo-map");
    expect(ALL_MODULE_IDS).toHaveLength(7);
    expect(DEFAULT_PANELS_BY_ID["stereo-map"]).toEqual({
      id: "stereo-map",
      moduleId: "stereo-map",
    });
    expect(DEFAULT_WORKSPACE_STATE.panelOrder).toEqual([...ALL_MODULE_IDS, "stereo-map"]);
  });
});

describe("first-run workspace", () => {
  it("uses the layout tuned at 1280x800", () => {
    const leaf = (id) => ({ type: "leaf", tabs: [id], activeTab: id });
    expect(DEFAULT_WORKSPACE_STATE.tree).toEqual({
      type: "split",
      direction: "h",
      sizes: [0.132, null, 0.18],
      children: [
        leaf("levelMeter"),
        {
          type: "split",
          direction: "v",
          sizes: [null, null, null, null],
          children: [
            {
              type: "split",
              direction: "h",
              sizes: [null, null],
              children: [leaf("loudness"), leaf("waveform")],
            },
            leaf("spectrogram"),
            leaf("spectrum"),
            leaf("stereo-map"),
          ],
        },
        {
          type: "split",
          direction: "v",
          sizes: [0.623, null],
          children: [leaf("stats"), leaf("vectorscope")],
        },
      ],
    });
  });

  it("gives only the first-run panels the tuned controls", () => {
    const controls = DEFAULT_WORKSPACE_STATE.panelControlsById;
    expect(controls.levelMeter.levelMeterTpMaxMarker).toBe(true);
    expect(controls.loudness.loudnessHistoryVisibleLayerIds).toEqual(["momentary", "shortTerm", "ref"]);
    expect(controls.stats.statsVisibleIds).toEqual(STATS_CANONICAL_ORDER);
    expect(controls.spectrum).toMatchObject({ spectrumView: "lr", spectrumMaxMode: "decay" });
    expect(controls.waveform).toMatchObject({
      waveformFrequencyColor: true,
      waveformCentroid: true,
    });
    const untouched = normalizePanelControls(DEFAULT_PANEL_CONTROLS);
    expect(controls.vectorscope).toEqual(untouched);
    expect(controls.spectrogram).toEqual(untouched);
    expect(controls["stereo-map"]).toEqual(untouched);
    // A panel added later starts from these, not from the first-run values.
    expect(DEFAULT_PANEL_CONTROLS).toMatchObject({
      levelMeterTpMaxMarker: false,
      spectrumView: "combined",
      spectrumMaxMode: "off",
      waveformFrequencyColor: false,
      waveformCentroid: false,
    });
  });
```

(The closing `});` of `describe("stereo map registration", ...)` now sits above the new describe,
and the new describe's own `});` ends the file.)

In `src/agentControl/panelAnalysis.test.js`, in the test
`"reports when a Stereo Map request is waiting for its selected pair"`, replace:

```js
      panelOrder: [...DEFAULT_WORKSPACE_STATE.panelOrder, "stereo-map"],
```

with:

```js
      panelOrder: DEFAULT_WORKSPACE_STATE.panelOrder,
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/workspace/constants.test.js`
Expected: FAIL — `DEFAULT_PANELS_BY_ID["stereo-map"]` is `undefined`, the tree differs, and `levelMeterTpMaxMarker` is `false`.

- [ ] **Step 3: Implement the first-run workspace in `constants.js`**

Replace everything from the first import line down to (not including) `export const DEFAULT_WORKSPACE_STATE = {` with:

```js
/** @import { TreeNode, ModuleId, WorkspaceState } from './types.js' */
import { createPanel } from "./panelInstances.js";
import { normalizePanelControlsById } from "./panelControlInstances.js";
import { normalizeAxisViewportsState } from "./axisViewports.js";
import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";
import { STATS_CANONICAL_ORDER } from "../lib/statsCatalog.js";

/** @type {ModuleId[]} */
export const ALL_MODULE_IDS = [
  "levelMeter",
  "loudness",
  "stats",
  "vectorscope",
  "spectrum",
  "spectrogram",
  "waveform",
];

/// The first-run panels: the seven original modules plus Stereo Map. Stereo Map stays out of
/// ALL_MODULE_IDS; it only joins the default layout.
/** @type {ModuleId[]} */
const DEFAULT_MODULE_IDS = [...ALL_MODULE_IDS, "stereo-map"];

// ---------------------------------------------------------------------------
// Default tree, hand-tuned at 1280x800 logical
// (docs/superpowers/specs/2026-09-14-first-run-defaults-design.md):
//   H[ leaf(levelMeter)
//    | V[ H[ leaf(loudness) | leaf(waveform) ] | leaf(spectrogram) | leaf(spectrum) | leaf(stereo-map) ]
//    | V[ leaf(stats) | leaf(vectorscope) ] ]
// ---------------------------------------------------------------------------

/** @type {TreeNode} */
export const DEFAULT_TREE = {
  type: "split",
  direction: "h",
  sizes: [0.132, null, 0.18],
  children: [
    { type: "leaf", tabs: ["levelMeter"], activeTab: "levelMeter" },
    {
      type: "split",
      direction: "v",
      sizes: [null, null, null, null],
      children: [
        {
          type: "split",
          direction: "h",
          sizes: [null, null],
          children: [
            { type: "leaf", tabs: ["loudness"], activeTab: "loudness" },
            { type: "leaf", tabs: ["waveform"], activeTab: "waveform" },
          ],
        },
        { type: "leaf", tabs: ["spectrogram"], activeTab: "spectrogram" },
        { type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" },
        { type: "leaf", tabs: ["stereo-map"], activeTab: "stereo-map" },
      ],
    },
    {
      type: "split",
      direction: "v",
      sizes: [0.623, null],
      children: [
        { type: "leaf", tabs: ["stats"], activeTab: "stats" },
        { type: "leaf", tabs: ["vectorscope"], activeTab: "vectorscope" },
      ],
    },
  ],
};

/** @type {WorkspaceState} */
export const DEFAULT_PANELS_BY_ID = Object.fromEntries(
  DEFAULT_MODULE_IDS.map((moduleId) => {
    const panel = createPanel(moduleId, {}, { id: moduleId });
    return [panel.id, panel];
  })
);

export const DEFAULT_PANEL_ORDER = [...DEFAULT_MODULE_IDS];

/// Controls the first-run panels carry on top of the panel defaults. Only these instances get them:
/// DEFAULT_PANEL_CONTROLS is unchanged, so a panel the user adds later starts from the defaults.
const FIRST_RUN_PANEL_CONTROLS = {
  levelMeter: { levelMeterTpMaxMarker: true },
  stats: { statsVisibleIds: [...STATS_CANONICAL_ORDER] },
  spectrum: { spectrumView: "lr", spectrumMaxMode: "decay" },
  waveform: { waveformFrequencyColor: true, waveformCentroid: true },
};

export const DEFAULT_PANEL_CONTROLS_BY_ID = normalizePanelControlsById(
  DEFAULT_PANELS_BY_ID,
  Object.fromEntries(
    DEFAULT_MODULE_IDS.map((id) => [
      id,
      { ...DEFAULT_PANEL_CONTROLS, ...FIRST_RUN_PANEL_CONTROLS[id] },
    ])
  )
);
```

`DEFAULT_WORKSPACE_STATE` below stays unchanged. `WorkspaceContext.initState` and the reducer's
`RESET_WORKSPACE` both read it, so a fresh profile and Reset Layout both get the tuned layout.

- [ ] **Step 4: Run the workspace and Agent Control tests**

Run: `npx prettier --write src/workspace/constants.js src/workspace/constants.test.js src/agentControl/panelAnalysis.test.js`
Run: `npx vitest run src/workspace src/agentControl`
Expected: PASS. If another test fails because it pins the old seven-panel default (a panel count,
a `panelOrder` literal, or Stereo Map's absence), update that fixture to the new default and note
it in the commit message. Any other failure: stop and investigate before changing code.

- [ ] **Step 5: Commit**

```bash
git add src/workspace/constants.js src/workspace/constants.test.js src/agentControl/panelAnalysis.test.js
git commit -m "feat(workspace): open on the hand-tuned first-run layout" -m "The default tree adds Stereo Map and puts Loudness beside Waveform, and the first-run panels carry the tuned controls: TP Max marker, all Stats metrics, Spectrum L/R with Max Decay, and Waveform Frequency Color with Centroid. DEFAULT_PANEL_CONTROLS is unchanged, so panels added later keep today's defaults." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Starter Loudness Profile active on first run

**Files:**
- Modify: `src/lib/loudnessProfileNormalize.js`
- Test: `src/lib/loudnessProfileNormalize.test.js`, `src/hooks/LoudnessProfileContext.test.jsx`, `src/App.smoke.test.jsx`, `src/components/PanelSettingsContent.test.jsx`

- [ ] **Step 1: Write the failing tests**

`src/lib/loudnessProfileNormalize.test.js`: in the test
`"cold-seeds malformed storage with exactly one injectable starter profile"`, rename it to
`"cold-seeds malformed storage with the starter profile selected"` and replace
`      active: "off",` in `expected` with `      active: profileSelectionId("starter-id"),`.

`src/hooks/LoudnessProfileContext.test.jsx`, test
`"uses one starter identity for first render and persisted Configuration"` — replace:

```js
    expect(hook.result.current.active).toBe(LOUDNESS_PROFILE_OFF);
    expect(hook.result.current.document).toBe(null);
    await waitFor(() =>
      expect(settingsStore.read().loudnessProfiles?.profiles[0].id).toBe(starterId)
    );
```

with:

```js
    expect(hook.result.current.active).toBe(profileSelectionId(starterId));
    expect(hook.result.current.document).toEqual(hook.result.current.profiles[0]);
    await waitFor(() =>
      expect(settingsStore.read().loudnessProfiles).toMatchObject({
        active: profileSelectionId(starterId),
        profiles: [{ id: starterId }],
      })
    );
```

Same file, test `"seeds the exact cold library after reset and provider remount"` — replace:

```js
    expect(second.result.current.active).toBe(LOUDNESS_PROFILE_OFF);
    expect(second.result.current.profiles).toHaveLength(1);
    expect(second.result.current.profiles[0]).toMatchObject(expectedStarter);
    expect(settingsStore.read().loudnessProfiles).toMatchObject({
      active: LOUDNESS_PROFILE_OFF,
      profiles: [expectedStarter],
    });
```

with:

```js
    const starterSelection = profileSelectionId(second.result.current.profiles[0].id);
    expect(second.result.current.active).toBe(starterSelection);
    expect(second.result.current.profiles).toHaveLength(1);
    expect(second.result.current.profiles[0]).toMatchObject(expectedStarter);
    expect(settingsStore.read().loudnessProfiles).toMatchObject({
      active: starterSelection,
      profiles: [expectedStarter],
    });
```

`src/App.smoke.test.jsx`, test `"renders the footer status hierarchy"` — replace:

```js
    // Off by default, so there is no profile to name and the whole item is absent.
    expect(footer().queryByText("Loudness")).toBeNull();
```

with:

```js
    // The starter profile is active on first run, so the footer names it.
    expect(footer().getByText("Loudness")).toBeTruthy();
    expect(footer().getByText("I −23 ±0.5 · TP ≤ −1")).toBeTruthy();
```

`src/components/PanelSettingsContent.test.jsx` — these two tests relied on a fresh store meaning
Off; make that explicit. In `"renders Loudness layers as an inline labeled detail and toggles layer ids"`,
insert as the first line of the test body:

```js
    settingsStore.patch({ loudnessProfiles: { active: "off", profiles: [TEST_PROFILE] } });
```

and change the comment `// Off by default, so \`ref\` is not offered and must not be counted.` to
`// Off, so \`ref\` is not offered and must not be counted.`
In `"counts only the layers it actually offers"`, insert the same `settingsStore.patch(...)` line as
the first line of the test body.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/loudnessProfileNormalize.test.js src/hooks/LoudnessProfileContext.test.jsx`
Expected: FAIL — `active` is `"off"` where `"profile:starter-id"` (or the starter's selection) is expected.

- [ ] **Step 3: Select the starter profile on cold seed**

In `src/lib/loudnessProfileNormalize.js`, add `profileSelectionId` to the existing named import from
`./loudnessProfileCatalog.js` (the import that already brings in `createStarterProfile`), then replace:

```js
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.profiles)) {
    return { active: LOUDNESS_PROFILE_OFF, profiles: [createStarterProfile(makeId)] };
  }
```

with:

```js
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.profiles)) {
    // First run (or unreadable storage): seed the starter profile and select it, so a new user
    // starts on a delivery-loudness check. A stored library, even an empty one, is left alone.
    const starter = createStarterProfile(makeId);
    return { active: profileSelectionId(starter.id), profiles: [starter] };
  }
```

If `LOUDNESS_PROFILE_OFF` is now unused in this file, ESLint reports it; it is still used by
`normalizeActive`, so keep the import unless ESLint says otherwise.

- [ ] **Step 4: Run the affected tests, then the whole suite**

Run: `npx prettier --write src/lib/loudnessProfileNormalize.js src/lib/loudnessProfileNormalize.test.js src/hooks/LoudnessProfileContext.test.jsx src/App.smoke.test.jsx src/components/PanelSettingsContent.test.jsx`
Run: `npx vitest run src/lib/loudnessProfileNormalize.test.js src/hooks/LoudnessProfileContext.test.jsx src/App.smoke.test.jsx src/components/PanelSettingsContent.test.jsx`
Expected: PASS.
Run: `npm test`
Expected: PASS. A test that fails because it assumed a fresh store is Off (no footer Loudness item,
no red status, no `ref` layer offered) gets an explicit
`settingsStore.patch({ loudnessProfiles: { active: "off", profiles: [...] } })` seed, as above. Any
other failure: stop and investigate.

- [ ] **Step 5: Commit**

```bash
git add src/lib/loudnessProfileNormalize.js src/lib/loudnessProfileNormalize.test.js src/hooks/LoudnessProfileContext.test.jsx src/App.smoke.test.jsx src/components/PanelSettingsContent.test.jsx
git commit -m "feat(loudness): select the starter profile on first run" -m "A fresh profile already seeded the I -23 +-0.5 TP <= -1 starter but left the selection Off. It is now selected, so the Loudness reference line and delivery checks are on from the first launch. Stored libraries, including an explicitly empty one or an Off selection, are untouched." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: First-run Dock form (top edge, 56 px)

**Files:**
- Modify: `src/dock/dockSizing.js`, `src/hooks/useDockMode.js`, `src-tauri/src/dock.rs`
- Test: `src/dock/dockSizing.test.js`, `src/hooks/useDockMode.test.js`, `src-tauri/src/dock.rs` tests

Why both sides: entering Dock from the normal window's Views menu always passes an explicit edge
but never a height, so first entry takes Rust's `DOCK_DEFAULT_LOGICAL_HEIGHT`. The frontend edge
default only matters where no edge is given (Agent Control `dock enter` without `--edge`, the Dock
header's edge toggle label); it changes for consistency.

- [ ] **Step 1: Write the failing tests**

`src/dock/dockSizing.test.js`, inside `describe("dock sizing", ...)`, add after the clamp test:

```js
  it("falls back to the compact first-run height", () => {
    expect(clampDockHeight(undefined)).toBe(56);
    expect(clampDockHeight("tall")).toBe(56);
  });
```

`src/hooks/useDockMode.test.js`, test `"starts disabled without injected state"` — replace:

```js
    expect(result.current.dockEdge).toBe("bottom");
    expect(result.current.reserveSpace).toBe(true);
```

with:

```js
    expect(result.current.dockEdge).toBe("top");
    expect(result.current.dockHeight).toBe(56);
    expect(result.current.reserveSpace).toBe(true);
```

`src-tauri/src/dock.rs`, test `dock_state_serializes_camel_case_and_lowercase_edge` — replace
`    assert_eq!(v["height"], 72);` with `    assert_eq!(v["height"], 56);`, and add below that test:

```rust
  #[test]
  fn first_run_dock_height_is_the_compact_minimum() {
    assert_eq!(DOCK_DEFAULT_LOGICAL_HEIGHT, DOCK_MIN_LOGICAL_HEIGHT);
  }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/dock/dockSizing.test.js src/hooks/useDockMode.test.js`
Expected: FAIL — `72` received where `56` is expected, and `"bottom"` where `"top"` is expected.
Run: `cargo test --manifest-path src-tauri/Cargo.toml dock::tests`
Expected: FAIL — `left: 72, right: 56`.

- [ ] **Step 3: Change the defaults**

`src/dock/dockSizing.js`: replace `export const DOCK_DEFAULT_HEIGHT = 72;` with:

```js
/// First-run Dock height: the compact mode the Dock was tuned at. Matches Rust's
/// DOCK_DEFAULT_LOGICAL_HEIGHT, which first entry uses because the GUI passes no height.
export const DOCK_DEFAULT_HEIGHT = 56;
```

`src/hooks/useDockMode.js`, in `normalizeDockState`, replace
`  const edge = raw?.edge === "top" ? "top" : "bottom";` with:

```js
  // No stored form (first run): the tuned first-run Dock sits on the top edge. Rust always writes an
  // edge, so this only decides the no-record case.
  const edge = raw?.edge === "bottom" ? "bottom" : "top";
```

`src-tauri/src/dock.rs`: replace `pub const DOCK_DEFAULT_LOGICAL_HEIGHT: u32 = 72;` with
`pub const DOCK_DEFAULT_LOGICAL_HEIGHT: u32 = 56;`. Leave the doc comment above it; it still
describes the constant.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/dock src/hooks/useDockMode.test.js`
Expected: PASS.
Run: `cargo test --manifest-path src-tauri/Cargo.toml dock::tests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dock/dockSizing.js src/dock/dockSizing.test.js src/hooks/useDockMode.js src/hooks/useDockMode.test.js src-tauri/src/dock.rs
git commit -m "feat(dock): enter on the top edge at 56 px on first run" -m "With no stored Dock form, the Dock now defaults to the top edge and the compact 56 px height it was tuned at. First GUI entry takes Rust's default height, so both sides change; stored forms are unaffected apart from very old records with no height field." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: First-run Dock panels, widths and settings

**Files:**
- Modify: `src/dock/dockLayout.js`, `src/dock/dockModuleControls.js`, `src/dock/useDockLayout.js`
- Test: `src/dock/dockLayout.test.js`, `src/dock/modules/DockStereoMap.test.jsx`, `src/dock/useDockLayout.test.js`
- Modify: `docs/superpowers/specs/2026-09-14-first-run-defaults-design.md` (panel id)

- [ ] **Step 1: Write the failing tests**

`src/dock/dockLayout.test.js`: replace the test `"enables all panels in the first-run product order"` with:

```js
  it("enables the tuned first-run panels in order", () => {
    expect(DEFAULT_DOCK_MODULES).toEqual([
      "transport",
      "level",
      "loudness",
      "stats",
      "correlation",
      "waveform",
      "spectrogram",
      "spectrum",
      "stereoMap",
    ]);
  });
```

and add inside `describe("normalizeDockLayout", ...)`:

```js
  it("pins the tuned first-run widths only when no module list is stored", () => {
    expect(normalizeDockLayout(undefined).panelSizesById).toEqual({
      transport: 90,
      level: 150,
      loudness: 210,
      stats: 370,
      correlation: 190,
      waveform: 260,
      spectrogram: 260,
      spectrum: 260,
      stereoMap: 260,
    });
    expect(normalizeDockLayout({ modules: ["spectrum", "level"] }).panelSizesById).toEqual({});
  });
```

`src/dock/modules/DockStereoMap.test.jsx`: replace the test
`"appears after Waveform in the Dock module catalog and is disabled by default"` with:

```js
  it("appears after Waveform in the Dock module catalog and ends the first-run strip", () => {
    expect(DOCK_PANEL_MODULE_IDS.indexOf("stereo-map")).toBe(
      DOCK_PANEL_MODULE_IDS.indexOf("waveform") + 1
    );
    expect(DEFAULT_DOCK_MODULES.at(-1)).toBe("stereoMap");
  });
```

`src/dock/useDockLayout.test.js`: add `import { STATS_CANONICAL_ORDER } from "../lib/statsCatalog.js";`
below the existing imports, add this constant below the imports:

```js
const FIRST_RUN_MODULES = [
  "transport",
  "level",
  "loudness",
  "stats",
  "correlation",
  "waveform",
  "spectrogram",
  "spectrum",
  "stereoMap",
];

const FIRST_RUN_SIZES = {
  transport: 90,
  level: 150,
  loudness: 210,
  stats: 370,
  correlation: 190,
  waveform: 260,
  spectrogram: 260,
  spectrum: 260,
  stereoMap: 260,
};
```

replace the whole test `"starts from defaults and persists toggles to workspaceStore"` with:

```js
  it("starts from the tuned first-run strip and persists toggles to workspaceStore", () => {
    const { result } = renderHook(() => useDockLayout());
    expect(result.current.modules).toEqual(FIRST_RUN_MODULES);
    expect(result.current.panelSizesById).toEqual(FIRST_RUN_SIZES);
    expect(Object.keys(result.current.controlsByPanelId)).toEqual(FIRST_RUN_MODULES.slice(1));
    expect(result.current.controlsByPanelId).toMatchObject({
      level: { levelMeterMode: "peak", readout: "live", showLabels: true },
      loudness: {
        showReadouts: false,
        loudnessHistoryVisibleLayerIds: ["momentary", "shortTerm", "ref"],
        loudnessYMinDb: -64,
        loudnessYMaxDb: 0,
      },
      stats: { statsVisibleIds: STATS_CANONICAL_ORDER },
      correlation: { vectorscopePair: { x: 0, y: 1 } },
      waveform: {
        waveformFrequencyColor: true,
        waveformLowMidSplitHz: 200,
        waveformMidHighSplitHz: 2000,
        waveformCentroid: false,
      },
      spectrogram: {
        spectrumChannel: { type: "pair", x: 0, y: 1 },
        spectrogramYMinFreq: 20,
        spectrogramYMaxFreq: 20000,
      },
      spectrum: {
        spectrumChannel: { type: "pair", x: 0, y: 1 },
        spectrumView: "combined",
        spectrumSpeedPercent: 25,
        spectrumOctaveSmoothing: "off",
        spectrumTiltDbPerOctave: 3,
        spectrumMaxMode: "decay",
        spectrumXMinFreq: 20,
        spectrumXMaxFreq: 20000,
        spectrumYMinDb: -96,
        spectrumYMaxDb: -12,
      },
      stereoMap: { stereoMapMode: "position", stereoMapPair: { x: 0, y: 1 } },
    });
    act(() => result.current.toggle("spectrum"));
    const withoutSpectrum = FIRST_RUN_MODULES.filter((id) => id !== "spectrum");
    expect(result.current.modules).toEqual(withoutSpectrum);
    expect(workspaceStore.read().dock.panelOrder).toEqual(withoutSpectrum);
    expect(workspaceStore.read().dock.controlsByPanelId.loudness.showReadouts).toBe(false);
    expect(workspaceStore.read().dock.modules).toBeUndefined();
  });
```

and in the test `"resetLayout restores the default modules, order and controls"`, replace:

```js
    expect(result.current.modules).toEqual([
      "transport",
      "level",
      "loudness",
      "stats",
      "correlation",
      "spectrum",
      "spectrogram",
      "waveform",
    ]);
    expect(result.current.controlsByModuleId.loudness.loudnessHistoryVisibleLayerIds).toEqual([
      "momentary",
      "shortTerm",
      "ref",
    ]);
```

with:

```js
    expect(result.current.modules).toEqual(FIRST_RUN_MODULES);
    expect(result.current.panelSizesById).toEqual(FIRST_RUN_SIZES);
    expect(result.current.controlsByModuleId.loudness).toMatchObject({
      showReadouts: false,
      loudnessHistoryVisibleLayerIds: ["momentary", "shortTerm", "ref"],
    });
    expect(workspaceStore.read().dock.controlsByPanelId.stats.statsVisibleIds).toEqual(
      STATS_CANONICAL_ORDER
    );
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/dock/dockLayout.test.js src/dock/modules/DockStereoMap.test.jsx src/dock/useDockLayout.test.js`
Expected: FAIL — old module order, `panelSizesById` is `{}`, `showReadouts` is `true`.

- [ ] **Step 3: First-run modules and widths in `dockLayout.js`**

Replace:

```js
/** Complete first-run Dock layout, ordered from transport/readouts to history views. */
export const DEFAULT_DOCK_MODULES = [
  "transport",
  "level",
  "loudness",
  "stats",
  "correlation",
  "spectrum",
  "spectrogram",
  "waveform",
];
```

with:

```js
/** Complete first-run Dock layout, as tuned (see the first-run defaults design doc). */
export const DEFAULT_DOCK_MODULES = [
  "transport",
  "level",
  "loudness",
  "stats",
  "correlation",
  "waveform",
  "spectrogram",
  "spectrum",
  "stereoMap",
];

/// First-run preferred widths (CSS px) by first-run panel id: what the tuned strip showed on a
/// 2048 px wide display, rounded to tens with the four history views equal.
export const DEFAULT_DOCK_PANEL_SIZES = Object.freeze({
  transport: 90,
  level: 150,
  loudness: 210,
  stats: 370,
  correlation: 190,
  waveform: 260,
  spectrogram: 260,
  spectrum: 260,
  stereoMap: 260,
});
```

In `normalizeDockLayout`, replace:

```js
  const list = raw && typeof raw === "object" ? raw.modules : undefined;
  const source = Array.isArray(list) ? list : DEFAULT_DOCK_MODULES;
```

with:

```js
  const list = raw && typeof raw === "object" ? raw.modules : undefined;
  const firstRun = !Array.isArray(list);
  const source = firstRun ? DEFAULT_DOCK_MODULES : list;
```

and replace the function's last statement:

```js
  return withLegacyModules({ panelsById, panelOrder, panelSizesById: {} });
```

with:

```js
  return withLegacyModules({
    panelsById,
    panelOrder,
    // Only the first-run layout pins widths; an explicit module list keeps responsive sizing.
    panelSizesById: firstRun ? normalizeDockPanelSizes(panelsById, DEFAULT_DOCK_PANEL_SIZES) : {},
  });
```

- [ ] **Step 4: First-run Dock controls in `dockModuleControls.js`**

Add `import { STATS_CANONICAL_ORDER } from "../lib/statsCatalog.js";` below the existing import
from `../lib/panelControls.js`. Directly below the function `normalizeDockControlsByModuleId`, add:

```js
/// Controls the first-run Dock panels carry on top of the Dock defaults, by Dock control module id.
/// Only the first-run strip and Reset Layout use them; a panel added later starts from the defaults.
const FIRST_RUN_DOCK_CONTROLS = Object.freeze({
  loudness: { showReadouts: false },
  stats: { statsVisibleIds: [...STATS_CANONICAL_ORDER] },
  spectrum: { spectrumMaxMode: "decay" },
  waveform: { waveformFrequencyColor: true },
});

export function firstRunDockControlsByModuleId() {
  return normalizeDockControlsByModuleId(
    Object.fromEntries(
      Object.entries(FIRST_RUN_DOCK_CONTROLS).map(([moduleId, overrides]) => [
        moduleId,
        { ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID[moduleId], ...overrides },
      ])
    )
  );
}
```

- [ ] **Step 5: Use them in `useDockLayout.js`**

Add `firstRunDockControlsByModuleId,` to the named import from `./dockModuleControls.js`. Replace:

```js
function readDockState() {
  const raw = workspaceStore.read().dock;
  const layout = normalizeDockLayout(raw);
  return {
    layout,
    controlsByPanelId: normalizeDockControlsByPanelId(layout.panelsById, raw?.controlsByPanelId),
  };
}
```

with:

```js
function readDockState() {
  const raw = workspaceStore.read().dock;
  const layout = normalizeDockLayout(raw);
  return {
    layout,
    // Nothing stored yet is the first run: the first-run panels take the tuned controls.
    controlsByPanelId: normalizeDockControlsByPanelId(
      layout.panelsById,
      raw?.controlsByPanelId,
      raw ? undefined : firstRunDockControlsByModuleId()
    ),
  };
}
```

and replace:

```js
  const resetLayout = useCallback(() => {
    setPanels({});
  }, [setPanels]);
```

with:

```js
  const resetLayout = useCallback(() => {
    // Back to the first-run strip: tuned modules, widths and controls.
    const layout = normalizeDockLayout(undefined);
    write({
      layout,
      controlsByPanelId: normalizeDockControlsByPanelId(
        layout.panelsById,
        undefined,
        firstRunDockControlsByModuleId()
      ),
    });
  }, [write]);
```

`resetPanelControls` / `resetModuleControls` keep resetting one panel to the module defaults, the
same as a Workspace panel's own reset.

- [ ] **Step 6: Record the first-run Stereo Map panel id in the spec**

In `docs/superpowers/specs/2026-09-14-first-run-defaults-design.md`, in the Dock "Panels and widths"
table, replace `| 9 | \`stereo-map\` | Stereo Map | 260 | 180 / 960 | flexible |` with
`| 9 | \`stereoMap\` | Stereo Map | 260 | 180 / 960 | flexible |`, and add below the table:
`First-run panel ids come from the legacy Dock module ids (\`level\`, \`correlation\`, \`stereoMap\`); the tuned strip's \`stereo-map\` id was only the id the Add Module flow generated.`

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx prettier --write src/dock/dockLayout.js src/dock/dockLayout.test.js src/dock/dockModuleControls.js src/dock/useDockLayout.js src/dock/useDockLayout.test.js src/dock/modules/DockStereoMap.test.jsx`
Run: `npx vitest run src/dock src/agentControl`
Expected: PASS. A failure that pins the old eight-module Dock default (a module list, `{}` sizes,
`showReadouts: true` on a fresh store) gets its fixture updated to the new default; anything else:
stop and investigate.

- [ ] **Step 8: Commit**

```bash
git add src/dock/dockLayout.js src/dock/dockLayout.test.js src/dock/dockModuleControls.js src/dock/useDockLayout.js src/dock/useDockLayout.test.js src/dock/modules/DockStereoMap.test.jsx docs/superpowers/specs/2026-09-14-first-run-defaults-design.md
git commit -m "feat(dock): open on the hand-tuned first-run strip" -m "The first-run Dock adds Stereo Map, moves Waveform ahead of the spectral views, pins the tuned widths (90/150/210/370/190 and 260 for the four history views), and applies the tuned controls: Loudness readouts off, all Stats metrics, Spectrum Max Decay, Waveform Frequency Color. Reset Layout returns to this strip; a panel added later and a single-panel reset keep the module defaults." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Full verification

- [ ] **Step 1: Merge gate**

Run: `npm run check`
Expected: exit 0 — version, Prettier, ESLint, all Vitest files, Vite build, `cargo fmt --check`,
clippy with `-D warnings`, and Rust tests all pass.

- [ ] **Step 2: Restore the dev-identity CLI host**

Run: `cargo build --manifest-path src-tauri/Cargo.toml --bin plvs --features dev-identity`
Expected: `Finished`. Without this, `npm run desktop:control` fails with `cliHostIdentityMismatch`.

- [ ] **Step 3: Build and launch on a fresh development profile**

1. Close any running development PLVS by PID (`target\release\plvs.exe` or `target\debug\plvs.exe`).
2. Move the development profile aside: rename `%APPDATA%\com.soundoer.plvs.dev` to
   `com.soundoer.plvs.dev.bak-<yyyymmdd>`.
3. Run `npm run desktop:build`, then start `src-tauri\target\release\plvs.exe`.

- [ ] **Step 4: Verify the normal window through Agent Control**

Run: `npm run desktop:control -- inspect --json`
Expected:
- `workspace.layout` is the tuned tree (Level Meter | four-row middle column with Loudness beside
  Waveform and Stereo Map last | Stats over Vectorscope), weights ≈ 0.132 / remainder / 0.18.
- `workspace.panels`: Level Meter `tpMaxMarker: true`; Stats all 15 visible; Spectrum `view: "lr"`,
  `maxMode: "decay"`; Waveform `frequencyColor: true`, `centroid: true`; Loudness layers include
  `reference`.
- `loudnessProfile.activeId` is the starter profile id (not `null`).

Run: `npm run desktop:control -- visual screenshot --target main --out first-run-main.png --json`
Expected on the 2560×1440 @125% primary: `width: 1600`, `height: 1000`. The window is centered in
the primary work area (visual check).

- [ ] **Step 5: Verify the Dock**

Run: `npm run desktop:control -- inspect --json` and note `revision` as N.
Run: `npm run desktop:control -- dock enter --expected-revision N --json`
Run: `npm run desktop:control -- dock inspect --json`
Expected: `edge: "top"`, `height: 56`, `reserveSpace: true`; panels in order transport, level,
loudness, stats, correlation, waveform, spectrogram, spectrum, stereoMap with widths
90/150/210/370/190/260/260/260/260; Loudness `showReadouts: false` and layers include
`reference`; Stats all 15; Spectrum `maxMode: "decay"`; Waveform `frequencyColor: true`.

- [ ] **Step 6: Restore the development profile**

Close the app by PID, delete the fresh `%APPDATA%\com.soundoer.plvs.dev`, and rename the
`.bak-<yyyymmdd>` folder back to `com.soundoer.plvs.dev`.

- [ ] **Step 7: Hand over for manual checks**

Ask the user to check on their own machines: the window placement on a laptop-class display
(1920×1080 @125% should open ≈ 1138×711 logical, centered), and on macOS (centered, fitted), and
the first Dock entry from the Views menu (56 px on the chosen edge).
