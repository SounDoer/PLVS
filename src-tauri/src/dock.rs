// Not yet wired into commands/state; consumed starting with the dock-mode
// wiring task. Remove this once callers land.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use crate::window_state::{MonitorRect, WindowBounds};

/// Logical (DPI-independent) strip height. Single source of truth: the
/// frontend strip simply fills the viewport, so no JS copy of this number.
pub const DOCK_STRIP_LOGICAL_HEIGHT: f64 = 72.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DockEdge {
  Top,
  Bottom,
}

/// Persisted under the Rust-owned top-level `dockState` key in
/// `plvs-settings.json` (sibling of `windowBounds`; same single-owner rule).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockStateRecord {
  pub enabled: bool,
  pub edge: DockEdge,
  #[serde(default)]
  pub monitor: Option<String>,
}

/// Compute the docked strip rect (physical px) inside a monitor work area.
pub fn dock_strip_rect(work_area: MonitorRect, edge: DockEdge, height: u32) -> WindowBounds {
  let height = height.min(work_area.height).max(1);
  let y = match edge {
    DockEdge::Top => work_area.y,
    DockEdge::Bottom => work_area.y + work_area.height as i32 - height as i32,
  };
  WindowBounds {
    x: work_area.x,
    y,
    width: work_area.width,
    height,
    is_maximized: false,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn wa() -> MonitorRect {
    // e.g. 1920x1080 monitor with a 40px taskbar at the bottom
    MonitorRect {
      x: 0,
      y: 0,
      width: 1920,
      height: 1040,
    }
  }

  #[test]
  fn top_edge_spans_work_area_width_at_its_top() {
    let r = dock_strip_rect(wa(), DockEdge::Top, 108);
    assert_eq!((r.x, r.y, r.width, r.height), (0, 0, 1920, 108));
    assert!(!r.is_maximized);
  }

  #[test]
  fn bottom_edge_sits_flush_above_the_taskbar() {
    let r = dock_strip_rect(wa(), DockEdge::Bottom, 108);
    assert_eq!((r.x, r.y, r.width, r.height), (0, 1040 - 108, 1920, 108));
  }

  #[test]
  fn secondary_monitor_offsets_are_respected() {
    let wa2 = MonitorRect {
      x: 1920,
      y: -200,
      width: 2560,
      height: 1400,
    };
    let r = dock_strip_rect(wa2, DockEdge::Bottom, 150);
    assert_eq!((r.x, r.y, r.width), (1920, -200 + 1400 - 150, 2560));
  }

  #[test]
  fn height_is_clamped_to_work_area() {
    let tiny = MonitorRect {
      x: 0,
      y: 0,
      width: 800,
      height: 50,
    };
    let r = dock_strip_rect(tiny, DockEdge::Top, 108);
    assert_eq!(r.height, 50);
  }

  #[test]
  fn dock_state_serializes_camel_case_and_lowercase_edge() {
    let s = DockStateRecord {
      enabled: true,
      edge: DockEdge::Bottom,
      monitor: Some("\\\\.\\DISPLAY1".into()),
    };
    let v = serde_json::to_value(&s).unwrap();
    assert_eq!(v["enabled"], true);
    assert_eq!(v["edge"], "bottom");
    assert_eq!(v["monitor"], "\\\\.\\DISPLAY1");
    let back: DockStateRecord = serde_json::from_value(v).unwrap();
    assert_eq!(back, s);
  }
}
