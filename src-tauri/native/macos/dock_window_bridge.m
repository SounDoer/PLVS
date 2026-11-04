#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#import "dock_window_policy.h"

// tauri-nspanel owns class conversion, retaining the Tauri delegate and WebView identity.
// AppKit objects and every callback below are confined to main.
static char roleKey, desiredKey, savedBehaviorKey, savedChromeKey;
enum { MainRole = 0, HeaderRole = 1, EditorRole = 2, UpdateRole = 3, ImportRole = 4, SettingsRole = 5 };

@interface PLVSDockWindows : NSObject
@property (weak) NSWindow *main;
@property NSHashTable<NSWindow *> *members;
@property NSWindow *desktopProbe;
@property NSTimer *fallback;
@property BOOL enabled;
@property BOOL wanted;
@property BOOL aboveFullScreen;
@property BOOL top;
@property BOOL reconciling;
@property BOOL hiddenForSpace;
@property double height;
@property NSUInteger ticket;
@property (copy) void (^report)(int32_t);
@property id globalMouse;
@property id localMouse;
@property id activation;
@end

@implementation PLVSDockWindows
- (instancetype)init {
  if ((self = [super init])) {
    self.members = NSHashTable.weakObjectsHashTable;
    __weak PLVSDockWindows *weak = self;
    [NSWorkspace.sharedWorkspace.notificationCenter addObserverForName:NSWorkspaceActiveSpaceDidChangeNotification
      object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
        (void)note; [weak scheduleReconcile];
      }];
    for (NSNotificationName name in @[NSApplicationDidChangeScreenParametersNotification,
         NSWindowDidMoveNotification, NSWindowDidResizeNotification,
         NSApplicationDidHideNotification, NSApplicationDidUnhideNotification]) {
      [NSNotificationCenter.defaultCenter addObserverForName:name object:nil queue:NSOperationQueue.mainQueue
        usingBlock:^(NSNotification *note) {
          if (note.object == weak.main || note.object == NSApp || [note.name isEqual:NSApplicationDidChangeScreenParametersNotification])
            [weak scheduleReconcile];
        }];
    }
  }
  return self;
}
- (void)scheduleReconcile {
  if (!self.enabled || self.reconciling) return;
  [self syncFallback];
  [self reconcile];
  NSUInteger ticket = ++self.ticket;
  __weak PLVSDockWindows *weak = self;
  // Space animation can outlive its notification. Bounded retries complement the idle fallback.
  for (NSNumber *delay in @[@0.1, @0.4]) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay.doubleValue * NSEC_PER_SEC)),
      dispatch_get_main_queue(), ^{ if (weak.ticket == ticket) [weak reconcile]; });
  }
}
- (void)syncFallback {
  if (!self.enabled || !self.wanted || NSApp.hidden) { [self.fallback invalidate]; self.fallback = nil; return; }
  if (self.fallback) return;
  __weak PLVSDockWindows *weak = self;
  self.fallback = [NSTimer timerWithTimeInterval:1 repeats:YES block:^(NSTimer *timer) {
    (void)timer; [weak reconcile];
  }];
  [NSRunLoop.mainRunLoop addTimer:self.fallback forMode:NSRunLoopCommonModes];
}
- (BOOL)mayShow:(NSWindow *)window {
  if (NSApp.hidden) return NO;
  BOOL desired = [objc_getAssociatedObject(window, &desiredKey) boolValue];
  return plvs_dock_may_show(self.enabled, self.wanted, self.hiddenForSpace, window == self.main, desired);
}
- (void)present:(NSWindow *)window focus:(BOOL)focus {
  if (![self mayShow:window]) { [window orderOut:nil]; return; }
  if (focus) [window makeKeyAndOrderFront:nil];
  else if (!window.visible) [window orderFrontRegardless];
}
- (void)stopOutsideWatch {
  if (self.globalMouse) [NSEvent removeMonitor:self.globalMouse];
  if (self.localMouse) [NSEvent removeMonitor:self.localMouse];
  if (self.activation) [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:self.activation];
  self.globalMouse = nil; self.localMouse = nil; self.activation = nil;
}
- (void)syncOutsideWatch {
  BOOL accessoryShown = NO;
  for (NSWindow *window in self.members) {
    NSInteger role = [objc_getAssociatedObject(window, &roleKey) integerValue];
    if ((role == HeaderRole || role == EditorRole) && window.visible) accessoryShown = YES;
  }
  if (!self.enabled || !self.wanted || self.hiddenForSpace || !accessoryShown) {
    [self stopOutsideWatch]; return;
  }
  if (self.globalMouse || self.localMouse || self.activation) return;
  __weak PLVSDockWindows *weak = self;
  NSEventMask clicks = NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown | NSEventMaskOtherMouseDown;
  self.globalMouse = [NSEvent addGlobalMonitorForEventsMatchingMask:clicks handler:^(NSEvent *event) {
    (void)event; if (weak.report) weak.report(0);
  }];
  self.localMouse = [NSEvent addLocalMonitorForEventsMatchingMask:clicks handler:^NSEvent *(NSEvent *event) {
    if (event.window && ![weak.members containsObject:event.window] && weak.report) weak.report(0);
    return event;
  }];
  self.activation = [NSWorkspace.sharedWorkspace.notificationCenter
    addObserverForName:NSWorkspaceDidActivateApplicationNotification object:nil queue:NSOperationQueue.mainQueue
    usingBlock:^(NSNotification *note) {
      NSRunningApplication *app = note.userInfo[NSWorkspaceApplicationKey];
      if (app && app.processIdentifier != NSRunningApplication.currentApplication.processIdentifier && weak.report)
        weak.report(0);
    }];
}
- (void)reconcile {
  if (!self.enabled || self.reconciling || !self.main) return;
  self.reconciling = YES;
  NSScreen *screen = self.main.screen;
  if (!screen) { self.reconciling = NO; return; }
  if (!self.desktopProbe) {
    // An ordinary window can join desktop Spaces but is ineligible for other apps' full-screen
    // Spaces. Querying its public membership avoids AX, window enumeration and capture permission.
    self.desktopProbe = [[NSWindow alloc] initWithContentRect:NSMakeRect(NSMidX(screen.frame),
      NSMidY(screen.frame), 1, 1) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
    self.desktopProbe.releasedWhenClosed = NO;
    self.desktopProbe.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
      NSWindowCollectionBehaviorFullScreenPrimary | NSWindowCollectionBehaviorIgnoresCycle |
      NSWindowCollectionBehaviorTransient;
    self.desktopProbe.alphaValue = 0;
    self.desktopProbe.ignoresMouseEvents = YES;
    self.desktopProbe.hasShadow = NO;
    self.desktopProbe.excludedFromWindowsMenu = YES;
    self.desktopProbe.accessibilityElement = NO;
    [self.desktopProbe orderFrontRegardless];
  }
  NSPoint point = NSMakePoint(NSMidX(screen.frame), NSMidY(screen.frame));
  if (!NSEqualPoints(self.desktopProbe.frame.origin, point))
    [self.desktopProbe setFrameOrigin:point];
  BOOL fullScreen = !self.desktopProbe.onActiveSpace;
  BOOL wasHidden = self.hiddenForSpace;
  self.hiddenForSpace = fullScreen && !self.aboveFullScreen;
  NSRect before = self.main.frame;
  NSRect frame = plvs_dock_frame(screen.visibleFrame, screen.frame, screen.safeAreaInsets,
    fullScreen, self.top, self.height);
  BOOL changed = !NSEqualRects(frame, before);
  if (changed) {
    [self.main setFrame:frame display:NO];
    double dx = frame.origin.x - before.origin.x;
    double dy = self.top ? NSMaxY(frame) - NSMaxY(before) : frame.origin.y - before.origin.y;
    double dw = frame.size.width - before.size.width;
    for (NSWindow *window in self.members) {
      if (window == self.main) continue;
      NSInteger role = [objc_getAssociatedObject(window, &roleKey) integerValue];
      NSRect next = window.frame;
      next.origin.x += dx + (role == HeaderRole ? 0 : (role == EditorRole || role == SettingsRole) ? dw : dw / 2);
      next.origin.y += dy;
      if (role == HeaderRole) next.size.width = frame.size.width;
      [window setFrame:next display:NO];
    }
  }
  for (NSWindow *window in self.members) [self present:window focus:NO];
  [self syncOutsideWatch];
  self.reconciling = NO;
  if (self.hiddenForSpace && !wasHidden && self.report) self.report(0);
  if (changed && self.report) self.report(1);
}
@end

static PLVSDockWindows *owner;
static PLVSDockWindows *windows(void) {
  if (!owner) owner = [PLVSDockWindows new];
  return owner;
}

bool plvs_macos_window_on_main(void) { return NSThread.isMainThread; }

int32_t plvs_macos_dock_window_configure(void *raw, bool enabled, bool top, double height,
                                       bool above, void (*report)(int32_t)) {
  NSWindow *window = (__bridge NSWindow *)raw;
  if (![window isKindOfClass:NSPanel.class]) return 1;
  PLVSDockWindows *state = windows();
  state.main = window;
  [state.members addObject:window];
  objc_setAssociatedObject(window, &roleKey, @(MainRole), OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  state.report = ^(int32_t kind) { if (report) report(kind); };
  NSNumber *saved = objc_getAssociatedObject(window, &savedBehaviorKey);
  if (enabled) {
    if (!saved) objc_setAssociatedObject(window, &savedBehaviorKey, @(window.collectionBehavior),
      OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    if (!state.enabled) state.wanted = YES;
    state.enabled = YES; state.top = top; state.height = height; state.aboveFullScreen = above;
    ((NSPanel *)window).floatingPanel = YES;
    window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
      NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorCanJoinAllApplications;
    [state syncFallback]; [state scheduleReconcile];
  } else {
    state.enabled = NO; state.hiddenForSpace = NO; state.ticket++;
    [state syncFallback]; [state stopOutsideWatch];
    [state.desktopProbe close]; state.desktopProbe = nil;
    ((NSPanel *)window).floatingPanel = NO;
    if (saved) window.collectionBehavior = saved.unsignedIntegerValue;
    objc_setAssociatedObject(window, &savedBehaviorKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  return 0;
}

int32_t plvs_macos_dock_accessory_configure(void *raw, int32_t role) {
  NSWindow *window = (__bridge NSWindow *)raw;
  if (![window isKindOfClass:NSPanel.class] || role < HeaderRole || role > SettingsRole) return 1;
  PLVSDockWindows *state = windows();
  [state.members addObject:window];
  objc_setAssociatedObject(window, &roleKey, @(role), OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  ((NSPanel *)window).floatingPanel = YES;
  window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
    NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorCanJoinAllApplications;
  return 0;
}

void plvs_macos_dock_window_present(void *raw, bool visible, bool focus) {
  NSWindow *window = (__bridge NSWindow *)raw;
  objc_setAssociatedObject(window, &desiredKey, @(visible), OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  PLVSDockWindows *state = windows();
  if (window == state.main && state.enabled) {
    if (visible && NSApp.hidden) [NSApp unhideWithoutActivation];
    state.wanted = visible; [state syncFallback];
    if (visible) [state scheduleReconcile];
  }
  [state present:window focus:focus]; [state syncOutsideWatch];
}

void plvs_macos_dock_window_normal(void *raw) {
  NSWindow *window = (__bridge NSWindow *)raw;
  [NSApp unhideWithoutActivation]; [NSApp activate]; [window makeKeyAndOrderFront:nil];
}

void plvs_macos_dock_window_reveal(void *raw) {
  PLVSDockWindows *state = windows();
  [state scheduleReconcile];
  [state present:(__bridge NSWindow *)raw focus:NO];
}

// Called after Tauri has processed preceding window messages. Tao queues decoration changes on
// the main dispatch queue; conversion must wait for that queue without blocking AppKit's thread.
void plvs_macos_after_window_updates(void (*callback)(void *), void *context) {
  dispatch_async(dispatch_get_main_queue(), ^{ callback(context); });
}

// Title-bar toggles can leave FullSizeContentView either set or clear in ordinary Tauri windows.
// Retain the actual pre-Dock content policy rather than imposing the builder's default on exit.
void plvs_macos_dock_remember_chrome(void *raw) {
  NSWindow *window = (__bridge NSWindow *)raw;
  if ([window isKindOfClass:NSPanel.class] || objc_getAssociatedObject(window, &savedChromeKey)) return;
  objc_setAssociatedObject(window, &savedChromeKey,
    @[@((window.styleMask & NSWindowStyleMaskFullSizeContentView) != 0), @(window.titlebarAppearsTransparent)],
    OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}
void plvs_macos_dock_restore_chrome(void *raw) {
  NSWindow *window = (__bridge NSWindow *)raw;
  NSArray<NSNumber *> *saved = objc_getAssociatedObject(window, &savedChromeKey);
  if (!saved) return;
  NSWindowStyleMask mask = window.styleMask & ~NSWindowStyleMaskFullSizeContentView;
  if (saved[0].boolValue) mask |= NSWindowStyleMaskFullSizeContentView;
  window.titlebarAppearsTransparent = saved[1].boolValue;
  window.styleMask = mask;
  objc_setAssociatedObject(window, &savedChromeKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

int32_t plvs_macos_dock_saved_chrome(void *raw) {
  NSArray<NSNumber *> *saved = objc_getAssociatedObject((__bridge NSWindow *)raw, &savedChromeKey);
  return saved ? (saved[0].boolValue ? 1 : 0) | (saved[1].boolValue ? 2 : 0) : -1;
}
void plvs_macos_dock_boot_chrome(void *raw, uint8_t policy) {
  if (policy > 3) return;
  objc_setAssociatedObject((__bridge NSWindow *)raw, &savedChromeKey,
    @[@((policy & 1) != 0), @((policy & 2) != 0)], OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}
