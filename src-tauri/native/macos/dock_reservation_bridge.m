#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>

// Public AX window management, not a system work-area registration. AppKit snapshots are
// collected on main; AX calls and journal I/O run on a private serial queue.
static dispatch_queue_t queue;
static dispatch_source_t timer;
static NSMutableArray<NSMutableDictionary *> *records;
static NSString *journalPath;
static BOOL enabled;
static BOOL topEdge;
static double stripHeight;
static NSNumber *displayID;
static NSUInteger generation;
static id candidate;
static NSRect candidateFrame;
static CFAbsoluteTime stableSince;
static id blockedWindow;
static NSRect blockedFrame;
static BOOL snapshotInFlight; // Main queue only: never accumulate AX work behind a slow host.

static id attribute(AXUIElementRef element, CFStringRef name) {
  CFTypeRef value = NULL;
  if (AXUIElementCopyAttributeValue(element, name, &value) != kAXErrorSuccess) return nil;
  return CFBridgingRelease(value);
}

static BOOL geometry(AXUIElementRef window, NSRect *frame) {
  id point = attribute(window, kAXPositionAttribute);
  id size = attribute(window, kAXSizeAttribute);
  if (!point || !size || CFGetTypeID((__bridge CFTypeRef)point) != AXValueGetTypeID() ||
      CFGetTypeID((__bridge CFTypeRef)size) != AXValueGetTypeID()) return NO;
  CGPoint p;
  CGSize s;
  if (!AXValueGetValue((__bridge AXValueRef)point, kAXValueCGPointType, &p) ||
      !AXValueGetValue((__bridge AXValueRef)size, kAXValueCGSizeType, &s)) return NO;
  *frame = NSMakeRect(p.x, p.y, s.width, s.height);
  return isfinite(p.x) && isfinite(p.y) && isfinite(s.width) && isfinite(s.height) &&
         s.width > 0 && s.height > 0;
}

static BOOL matches(NSRect a, NSRect b) {
  return fabs(a.origin.x - b.origin.x) <= 1 && fabs(a.origin.y - b.origin.y) <= 1 &&
         fabs(a.size.width - b.size.width) <= 1 && fabs(a.size.height - b.size.height) <= 1;
}

static BOOL eligible(AXUIElementRef window) {
  if (![attribute(window, kAXSubroleAttribute) isEqual:(__bridge NSString *)kAXStandardWindowSubrole] ||
      [attribute(window, kAXMinimizedAttribute) boolValue] ||
      [attribute(window, CFSTR("AXFullScreen")) boolValue]) return NO;
  Boolean writable = false;
  if (AXUIElementIsAttributeSettable(window, kAXPositionAttribute, &writable) != kAXErrorSuccess ||
      !writable) return NO;
  return AXUIElementIsAttributeSettable(window, kAXSizeAttribute, &writable) == kAXErrorSuccess && writable;
}

static BOOL setFrame(AXUIElementRef window, NSRect frame) {
  CGPoint point = frame.origin;
  CGSize size = frame.size;
  AXValueRef p = AXValueCreate(kAXValueCGPointType, &point);
  AXValueRef s = AXValueCreate(kAXValueCGSizeType, &size);
  BOOL ok = NO;
  if (p && s) {
    for (int attempt = 0; attempt < 2; attempt++) {
      if (AXUIElementSetAttributeValue(window, kAXSizeAttribute, s) != kAXErrorSuccess ||
          AXUIElementSetAttributeValue(window, kAXPositionAttribute, p) != kAXErrorSuccess) break;
      NSRect actual;
      if (geometry(window, &actual) && matches(actual, frame)) { ok = YES; break; }
      // AppKit can clamp growth before the move frees room. One correction is bounded.
    }
  }
  if (p) CFRelease(p);
  if (s) CFRelease(s);
  return ok;
}

static BOOL persist(void) {
  if (!journalPath) return YES;
  NSMutableArray *disk = [NSMutableArray array];
  for (NSDictionary *record in records) {
    NSMutableDictionary *copy = [record mutableCopy];
    [copy removeObjectForKey:@"element"];
    [disk addObject:copy];
  }
  NSData *data = [NSJSONSerialization dataWithJSONObject:disk options:0 error:nil];
  if (!data) return NO;
  NSString *temporary = [journalPath stringByAppendingFormat:@".%@.tmp", NSUUID.UUID.UUIDString];
  if (![[NSFileManager defaultManager] createFileAtPath:temporary contents:data
      attributes:@{NSFilePosixPermissions: @0600}]) return NO;
  if (rename(temporary.fileSystemRepresentation, journalPath.fileSystemRepresentation) == 0) return YES;
  [[NSFileManager defaultManager] removeItemAtPath:temporary error:nil];
  return NO;
}

static BOOL validRecord(NSDictionary *record) {
  if (![record isKindOfClass:NSDictionary.class] || ![record[@"pid"] isKindOfClass:NSNumber.class] ||
      ![record[@"launch"] isKindOfClass:NSNumber.class] || ![record[@"title"] isKindOfClass:NSString.class]) return NO;
  for (NSString *key in @[@"before", @"expected"]) {
    if (![record[key] isKindOfClass:NSString.class]) return NO;
    NSRect rect = NSRectFromString(record[key]);
    if (!isfinite(rect.origin.x) || !isfinite(rect.origin.y) || !isfinite(rect.size.width) ||
        !isfinite(rect.size.height) || rect.size.width <= 0 || rect.size.height <= 0) return NO;
  }
  return YES;
}

static BOOL loadJournal(NSString *path) {
  journalPath = path;
  records = [NSMutableArray array];
  if (![[NSFileManager defaultManager] fileExistsAtPath:path]) return YES;
  NSData *data = [NSData dataWithContentsOfFile:path];
  if (!data || data.length > 1024 * 1024) return NO;
  id value = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingMutableContainers error:nil];
  if (![value isKindOfClass:NSArray.class] || [value count] > 128) return NO;
  for (id record in value) {
    if (!validRecord(record)) return NO;
    [records addObject:record];
  }
  return YES;
}

// A journal recovered after a crash has no live AX identity. Require exactly one title+frame
// match in the same process incarnation. Never guess when the window is ambiguous.
static id resolve(NSMutableDictionary *record) {
  NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:[record[@"pid"] intValue]];
  if (!app.launchDate || app.processIdentifier == getpid() ||
      [app.bundleIdentifier hasPrefix:@"com.soundoer.plvs"] ||
      fabs(app.launchDate.timeIntervalSince1970 - [record[@"launch"] doubleValue]) > 0.001) return nil;
  if (record[@"element"]) return record[@"element"];
  AXUIElementRef application = AXUIElementCreateApplication(app.processIdentifier);
  AXUIElementSetMessagingTimeout(application, 0.15);
  NSArray *windows = attribute(application, kAXWindowsAttribute);
  CFRelease(application);
  if (![windows isKindOfClass:NSArray.class]) return nil;
  id found = nil;
  for (id item in windows) {
    NSRect frame;
    AXUIElementRef window = (__bridge AXUIElementRef)item;
    if ([attribute(window, kAXTitleAttribute) isEqual:record[@"title"]] && geometry(window, &frame) &&
        matches(frame, NSRectFromString(record[@"expected"]))) {
      if (found) return nil;
      found = item;
    }
  }
  return found;
}

static BOOL restore(void) {
  if (!AXIsProcessTrusted()) return records.count == 0;
  for (NSMutableDictionary *record in [records copy]) {
    id element = resolve(record);
    NSRect current;
    AXUIElementRef window = (__bridge AXUIElementRef)element;
    if (!element || !geometry(window, &current) || !matches(current, NSRectFromString(record[@"expected"]))) {
      // Closed/replaced or subsequently changed by the user: surrender ownership.
      [records removeObjectIdenticalTo:record];
      continue;
    }
    if (!eligible(window)) continue;
    if (setFrame(window, NSRectFromString(record[@"before"]))) {
      [records removeObjectIdenticalTo:record];
    } else if (geometry(window, &current)) {
      record[@"expected"] = NSStringFromRect(current);
    }
  }
  return persist() && records.count == 0;
}

static NSRect axRect(NSRect cocoa, double primaryTop) {
  return NSMakeRect(cocoa.origin.x, primaryTop - NSMaxY(cocoa), cocoa.size.width, cocoa.size.height);
}

static void adjust(NSRunningApplication *app, NSArray<NSValue *> *screens, NSRect work) {
  if (!enabled || !AXIsProcessTrusted() || !app.launchDate || app.isHidden ||
      app.activationPolicy != NSApplicationActivationPolicyRegular || app.processIdentifier == getpid() ||
      [app.bundleIdentifier hasPrefix:@"com.soundoer.plvs"]) return;
  if (CGEventSourceButtonState(kCGEventSourceStateCombinedSessionState, kCGMouseButtonLeft)) {
    candidate = nil;
    return;
  }
  AXUIElementRef application = AXUIElementCreateApplication(app.processIdentifier);
  AXUIElementSetMessagingTimeout(application, 0.15);
  id element = attribute(application, kAXFocusedWindowAttribute);
  CFRelease(application);
  if (!element) return;
  AXUIElementRef window = (__bridge AXUIElementRef)element;
  NSRect before;
  if (!eligible(window) || !geometry(window, &before)) return;
  if (!candidate || !CFEqual((__bridge CFTypeRef)candidate, (__bridge CFTypeRef)element) ||
      !matches(candidateFrame, before)) {
    candidate = element;
    candidateFrame = before;
    stableSince = CFAbsoluteTimeGetCurrent();
    return;
  }
  if (CFAbsoluteTimeGetCurrent() - stableSince < 0.5) return;
  if (blockedWindow && CFEqual((__bridge CFTypeRef)blockedWindow, (__bridge CFTypeRef)element) &&
      matches(blockedFrame, before)) return;

  // Only adjust a window primarily on the Dock's monitor. A partly intersecting adjacent
  // monitor is not permission to pull the window across displays.
  NSRect dominant = NSZeroRect;
  double best = 0;
  for (NSValue *value in screens) {
    NSRect screen = value.rectValue;
    NSRect intersection = NSIntersectionRect(before, screen);
    double area = intersection.size.width * intersection.size.height;
    if (area > best) { best = area; dominant = screen; }
  }
  if (best == 0 || !NSIntersectsRect(dominant, work)) return;
  NSRect available = work;
  available.size.height -= stripHeight;
  if (topEdge) available.origin.y += stripHeight;
  if (available.size.height <= 0) return;
  NSRect proposed = before;
  proposed.size.width = MIN(before.size.width, available.size.width);
  proposed.size.height = MIN(before.size.height, available.size.height);
  proposed.origin.x = MIN(MAX(before.origin.x, available.origin.x), NSMaxX(available) - proposed.size.width);
  proposed.origin.y = MIN(MAX(before.origin.y, available.origin.y), NSMaxY(available) - proposed.size.height);

  NSMutableDictionary *owned = nil;
  for (NSMutableDictionary *record in [records copy]) {
    if (record[@"element"] && CFEqual((__bridge CFTypeRef)record[@"element"], (__bridge CFTypeRef)element)) {
      if (matches(before, NSRectFromString(record[@"expected"]))) owned = record;
      else [records removeObjectIdenticalTo:record]; // User changes establish a new baseline.
    }
  }
  if (matches(before, proposed)) { persist(); return; }
  if (records.count >= 128) return;
  NSMutableDictionary *record = owned ?: [@{
    @"pid": @(app.processIdentifier), @"launch": @(app.launchDate.timeIntervalSince1970),
    @"title": attribute(window, kAXTitleAttribute) ?: @"", @"before": NSStringFromRect(before),
    @"element": element
  } mutableCopy];
  record[@"expected"] = NSStringFromRect(proposed);
  if (!owned) [records addObject:record];
  if (!persist()) {
    if (!owned) [records removeObjectIdenticalTo:record];
    else record[@"expected"] = NSStringFromRect(before);
    return;
  }
  BOOL fitted = setFrame(window, proposed);
  NSRect actual;
  if (geometry(window, &actual)) record[@"expected"] = NSStringFromRect(actual);
  persist();
  if (!fitted) {
    // An application minimum can accept the move but refuse shrinkage. Undo the partial
    // adjustment, then leave this geometry alone until the user changes it.
    if (setFrame(window, before)) [records removeObjectIdenticalTo:record];
    else if (geometry(window, &actual)) record[@"expected"] = NSStringFromRect(actual);
    blockedWindow = element;
    if (geometry(window, &blockedFrame)) candidateFrame = blockedFrame;
    persist();
  }
}

static void initialize(void) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    queue = dispatch_queue_create("com.soundoer.plvs.dock-reservation", DISPATCH_QUEUE_SERIAL);
    records = [NSMutableArray array];
    timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(timer, DISPATCH_TIME_NOW, NSEC_PER_SEC / 4, NSEC_PER_SEC / 10);
    dispatch_source_set_event_handler(timer, ^{
      if (snapshotInFlight) return;
      snapshotInFlight = YES;
      // Configuration is read on the worker first so AppKit never races its state.
      dispatch_async(queue, ^{
        if (!enabled || !AXIsProcessTrusted()) {
          if (enabled) { enabled = NO; generation++; }
          dispatch_async(dispatch_get_main_queue(), ^{ snapshotInFlight = NO; });
          return;
        }
        NSNumber *target = displayID;
        NSUInteger ticket = generation;
        dispatch_async(dispatch_get_main_queue(), ^{
          NSArray<NSScreen *> *screens = NSScreen.screens;
          double primaryTop = screens.firstObject.frame.origin.y + screens.firstObject.frame.size.height;
          NSMutableArray *frames = [NSMutableArray array];
          NSScreen *selected = nil;
          for (NSScreen *screen in screens) {
            [frames addObject:[NSValue valueWithRect:axRect(screen.frame, primaryTop)]];
            if ([screen.deviceDescription[@"NSScreenNumber"] isEqual:target]) selected = screen;
          }
          NSRect work = selected ? axRect(selected.visibleFrame, primaryTop) : NSZeroRect;
          NSRunningApplication *front = NSWorkspace.sharedWorkspace.frontmostApplication;
          dispatch_async(queue, ^{
            if (ticket == generation && enabled) {
              if (!selected) { enabled = NO; generation++; restore(); }
              else adjust(front, frames, work);
            }
            dispatch_async(dispatch_get_main_queue(), ^{ snapshotInFlight = NO; });
          });
        });
      });
    });
    dispatch_resume(timer);
  });
}

// Status: 0 success, 1 permission required, 2 no display, 3 journal/recovery failure.
int32_t plvs_macos_dock_reservation_set(void *nativeWindow, bool on, bool top, uint32_t height,
                                      const char *path, bool prompt) {
  initialize();
  if (on && !AXIsProcessTrusted()) {
    if (prompt) AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)@{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES});
    return 1;
  }
  __block NSNumber *target = nil;
  if (on) {
    void (^snapshot)(void) = ^{
      NSWindow *window = (__bridge NSWindow *)nativeWindow;
      target = window.screen.deviceDescription[@"NSScreenNumber"];
    };
    if (NSThread.isMainThread) snapshot(); else dispatch_sync(dispatch_get_main_queue(), snapshot);
    if (!target) return 2;
  }
  NSString *next = path ? [NSString stringWithUTF8String:path] : nil;
  __block int32_t result = 0;
  dispatch_sync(queue, ^{
    enabled = NO;
    generation++;
    candidate = nil;
    blockedWindow = nil;
    if (!restore()) { result = 3; return; }
    if (!on) return;
    if (!loadJournal(next) || !restore() || !persist()) { result = 3; return; }
    displayID = target;
    topEdge = top;
    stripHeight = height;
    enabled = YES;
  });
  return result;
}

int32_t plvs_macos_dock_reservation_recover(const char *path) {
  initialize();
  if (!AXIsProcessTrusted()) return 1;
  NSString *file = [NSString stringWithUTF8String:path];
  __block int32_t result = 0;
  dispatch_sync(queue, ^{
    if (enabled || records.count) { result = 3; return; }
    if (!loadJournal(file) || !restore()) result = 3;
  });
  return result;
}

bool plvs_macos_dock_reservation_active(void) {
  initialize();
  __block bool active;
  dispatch_sync(queue, ^{ active = enabled; });
  return active;
}
