use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    // JS shape is `isMaximized`; rename so the JS/Rust JSON matches exactly.
    #[serde(rename = "isMaximized", default)]
    pub is_maximized: bool,
}

/// A monitor's visible rectangle (position + size), in physical pixels.
#[derive(Debug, Clone, Copy)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Returns the visible-overlap area (px²) between the window and a monitor.
fn overlap_area(b: &WindowBounds, m: &MonitorRect) -> i64 {
    let bx2 = b.x as i64 + b.width as i64;
    let by2 = b.y as i64 + b.height as i64;
    let mx2 = m.x as i64 + m.width as i64;
    let my2 = m.y as i64 + m.height as i64;
    let ix = (bx2.min(mx2) - (b.x as i64).max(m.x as i64)).max(0);
    let iy = (by2.min(my2) - (b.y as i64).max(m.y as i64)).max(0);
    ix * iy
}

/// If the window is mostly off-screen (less than 1/8 of its area visible on any monitor),
/// re-center it on the first monitor. Otherwise return it unchanged.
pub fn clamp_to_visible(b: WindowBounds, monitors: &[MonitorRect]) -> WindowBounds {
    if monitors.is_empty() {
        return b;
    }
    let area = b.width as i64 * b.height as i64;
    let visible = monitors.iter().map(|m| overlap_area(&b, m)).max().unwrap_or(0);
    if visible * 8 >= area {
        return b;
    }
    let m = monitors[0];
    let x = m.x + ((m.width as i32 - b.width as i32) / 2).max(0);
    let y = m.y + ((m.height as i32 - b.height as i32) / 2).max(0);
    WindowBounds { x, y, ..b }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mon() -> Vec<MonitorRect> {
        vec![MonitorRect { x: 0, y: 0, width: 1920, height: 1080 }]
    }

    #[test]
    fn keeps_a_fully_visible_window() {
        let b = WindowBounds { x: 100, y: 100, width: 1280, height: 800, is_maximized: false };
        assert_eq!(clamp_to_visible(b, &mon()), b);
    }

    #[test]
    fn recenters_a_window_on_a_gone_monitor() {
        let b = WindowBounds { x: 5000, y: 5000, width: 1280, height: 800, is_maximized: false };
        let c = clamp_to_visible(b, &mon());
        assert_eq!(c.width, 1280);
        assert_eq!(c.height, 800);
        assert_eq!(c.x, (1920 - 1280) / 2);
        assert_eq!(c.y, (1080 - 800) / 2);
    }

    #[test]
    fn empty_monitor_list_is_a_noop() {
        let b = WindowBounds { x: 100, y: 100, width: 1280, height: 800, is_maximized: false };
        assert_eq!(clamp_to_visible(b, &[]), b);
    }
}
