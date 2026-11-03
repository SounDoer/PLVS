#import <AppKit/AppKit.h>

// AppKit points; persisted bounds and Tauri accessory geometry remain physical pixels.
static inline NSRect plvs_dock_frame(NSRect desktop, NSRect display, NSEdgeInsets safe,
                                      BOOL fullScreen, BOOL top, double requestedHeight) {
  NSRect area = fullScreen ? display : desktop;
  if (fullScreen) {
    area.origin.x += safe.left;
    area.origin.y += safe.bottom;
    area.size.width -= safe.left + safe.right;
    area.size.height -= safe.top + safe.bottom;
  }
  double height = MIN(MAX(requestedHeight, 1), area.size.height);
  return NSMakeRect(area.origin.x, top ? NSMaxY(area) - height : area.origin.y,
    area.size.width, height);
}

static inline BOOL plvs_dock_may_show(BOOL enabled, BOOL wanted, BOOL hiddenForSpace,
                                      BOOL main, BOOL desired) {
  if (main && !enabled) return desired;
  return enabled && wanted && !hiddenForSpace && (main || desired);
}
