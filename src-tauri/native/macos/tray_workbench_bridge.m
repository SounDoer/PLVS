#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#include <stdbool.h>

typedef struct {
    double x, y, width, height;
} PlvsClickedIcon;

typedef struct {
    double x, y, width, height;
    double screen_x, screen_y, screen_width, screen_height;
    double scale;
} PlvsStatusItemGeometry;

bool plvs_tray_status_item_geometry(const void *item, PlvsClickedIcon clicked,
                                   PlvsStatusItemGeometry *geometry) {
    NSStatusBarButton *button = [(__bridge NSStatusItem *)item button];
    NSWindow *window = button.window;
    NSArray<NSScreen *> *screens = NSScreen.screens;
    NSScreen *primary = screens.firstObject;
    NSScreen *screen = window.screen;
    if (screen == nil || primary == nil) {
        return false;
    }

    NSPoint pointer = NSEvent.mouseLocation;
    NSRect bounds = [window convertRectToScreen:[button convertRect:button.bounds toView:nil]];
    double desktopTop = NSMaxY(primary.frame);
    // The status item's button belongs to one screen. AppKit also displays replicas in other
    // menu bars. Take the bounds from the click so the panel opens beneath the clicked replica.
    for (NSScreen *candidate in screens) {
        if (clicked.width <= 0 || clicked.height <= 0) {
            break;
        }
        if (!NSPointInRect(pointer, candidate.frame)) {
            continue;
        }
        double scale = candidate.backingScaleFactor;
        NSRect eventBounds = NSMakeRect(clicked.x / scale,
            desktopTop - (clicked.y + clicked.height) / scale,
            clicked.width / scale, clicked.height / scale);
        if (NSPointInRect(pointer, NSInsetRect(eventBounds, -1, -1))) {
            bounds = eventBounds;
        } else if (!NSPointInRect(pointer, NSInsetRect(bounds, -1, -1))) {
            // An inactive menu bar can deliver the primary button's bounds for a replica.
            bounds.origin.x = pointer.x - NSWidth(bounds) / 2;
            bounds.origin.y = NSMaxY(candidate.frame) - NSHeight(bounds);
        }
        screen = candidate;
        break;
    }

    NSRect frame = screen.frame;
    // AppKit uses bottom-left coordinates. The window builder uses a top-left desktop origin.
    *geometry = (PlvsStatusItemGeometry){
        NSMinX(bounds), desktopTop - NSMaxY(bounds), NSWidth(bounds), NSHeight(bounds),
        NSMinX(frame), desktopTop - NSMaxY(frame), NSWidth(frame), NSHeight(frame),
        screen.backingScaleFactor,
    };
    return true;
}

void plvs_tray_set_panel_frame(void *nativeWindow, double x, double y,
                               double width, double height) {
    NSWindow *panel = (__bridge NSWindow *)nativeWindow;
    double desktopTop = NSMaxY(NSScreen.screens.firstObject.frame);
    // Resizing with setContentSize: keeps the bottom edge fixed. Apply both the
    // size and the origin so the top edge stays at the Tray anchor.
    [panel setFrame:NSMakeRect(x, desktopTop - y - height, width, height) display:YES];
}

@interface PlvsTrayClickMonitor : NSObject
@property(nonatomic, strong) id token;
@end

@implementation PlvsTrayClickMonitor
- (void)dealloc {
    if (_token != nil) {
        [NSEvent removeMonitor:_token];
    }
}
@end

void plvs_tray_dismiss_on_outside_click(void *nativeWindow) {
    NSWindow *panel = (__bridge NSWindow *)nativeWindow;
    __weak NSWindow *weakPanel = panel;
    PlvsTrayClickMonitor *monitor = [PlvsTrayClickMonitor new];
    // AppKit can deliver a click to another window of the same app without changing its key window.
    monitor.token = [NSEvent addLocalMonitorForEventsMatchingMask:
        NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown | NSEventMaskOtherMouseDown
        handler:^NSEvent *(NSEvent *event) {
            NSWindow *menu = weakPanel;
            if (menu.visible && event.window != menu) {
                [menu orderOut:nil];
            }
            return event;
        }];
    static char monitorKey;
    objc_setAssociatedObject(panel, &monitorKey, monitor, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}
