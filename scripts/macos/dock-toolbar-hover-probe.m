#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
// Exercise the production presentation bridge and WebKit without posting system input.
#import "../../src-tauri/native/macos/dock_window_bridge.m"

@interface HoverProbePanel : NSPanel
@end
@implementation HoverProbePanel
- (BOOL)canBecomeKeyWindow { return YES; }
- (BOOL)canBecomeMainWindow { return NO; }
@end

static void pump(double seconds) {
  NSDate *end = [NSDate dateWithTimeIntervalSinceNow:seconds];
  while ([end timeIntervalSinceNow] > 0) {
    NSEvent *event = [NSApp nextEventMatchingMask:NSEventMaskAny untilDate:[NSDate dateWithTimeIntervalSinceNow:0.01] inMode:NSDefaultRunLoopMode dequeue:YES];
    if (event) [NSApp sendEvent:event];
    [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
  }
}
static id js(WKWebView *web, NSString *source) {
  __block BOOL done = NO;
  __block id result;
  __block NSError *failure;
  [web evaluateJavaScript:source completionHandler:^(id value, NSError *error) { result = value; failure = error; done = YES; }];
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5];
  while (!done && deadline.timeIntervalSinceNow > 0) pump(0.01);
  if (!done || failure) { NSLog(@"JavaScript failed: %@", failure); exit(2); }
  return result;
}
static void movement(NSWindow *window, NSView *view, int x) {
  NSEvent *event = [NSEvent mouseEventWithType:NSEventTypeMouseMoved location:NSMakePoint(x, 40) modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:window.windowNumber context:nil eventNumber:1 clickCount:0 pressure:0];
  // Deliver at WebKit's native tracking owner: NSWindow.sendEvent does not synthesize a
  // tracking-area hit, and posting system events would require Accessibility permission.
  for (NSTrackingArea *area in view.trackingAreas) {
    id owner = area.owner;
    if ([owner respondsToSelector:@selector(mouseMoved:)]) [owner mouseMoved:event];
  }
  for (NSView *child in view.subviews) movement(window, child, x);
}
int main(void) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    pid_t foreground = NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
    HoverProbePanel *main = [[HoverProbePanel alloc] initWithContentRect:NSMakeRect(80, 80, 480, 80) styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
    HoverProbePanel *header = [[HoverProbePanel alloc] initWithContentRect:NSMakeRect(80, 180, 480, 80) styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
    main.releasedWhenClosed = NO; header.releasedWhenClosed = NO;
    WKWebView *web = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 480, 80)];
    header.contentView = web;
    [web loadHTMLString:@"<html><body style='margin:0'><button style='width:200px;height:80px'>Hover</button><script>window.moves=0;document.addEventListener('mousemove',()=>window.moves++);</script></body></html>" baseURL:nil];
    plvs_macos_dock_window_configure((__bridge void *)main, true, false, 80, true, NULL);
    plvs_macos_dock_accessory_configure((__bridge void *)header, 1);
    plvs_macos_dock_window_present((__bridge void *)main, true, false);
    plvs_macos_dock_window_present((__bridge void *)header, true, false);
    pump(1);
    [main makeKeyWindow];
    pump(0.2);
    js(web, @"window.moves=0");
    movement(header, web, 70); pump(0.2);
    NSNumber *before = js(web, @"window.moves");
    BOOL beforeKey = header.keyWindow;
    plvs_macos_dock_window_present((__bridge void *)header, false, false);
    plvs_macos_dock_window_present((__bridge void *)header, true, true);
    pump(0.3);
    js(web, @"window.moves=0");
    movement(header, web, 80); pump(0.2);
    NSNumber *after = js(web, @"window.moves");
    NSDictionary *result = @{ @"beforeKey":@(beforeKey), @"beforeMoves":before, @"afterKey":@(header.keyWindow), @"afterMoves":after, @"appActive":@(NSApp.active), @"foregroundUnchanged":@(foreground == NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier) };
    // Repeated geometry/content updates of an already visible toolbar must keep editor focus.
    HoverProbePanel *editor = [[HoverProbePanel alloc] initWithContentRect:NSMakeRect(80, 280, 480, 80) styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
    editor.releasedWhenClosed = NO;
    plvs_macos_dock_accessory_configure((__bridge void *)editor, 2);
    plvs_macos_dock_window_present((__bridge void *)editor, true, true);
    plvs_macos_dock_window_present((__bridge void *)header, true, false);
    BOOL editorKeptKey = editor.keyWindow;
    plvs_macos_dock_window_present((__bridge void *)editor, false, false);
    plvs_macos_dock_window_present((__bridge void *)header, false, false);
    plvs_macos_dock_window_present((__bridge void *)header, true, true);
    pump(0.2);
    js(web, @"window.moves=0");
    movement(header, web, 90); pump(0.2);
    NSNumber *reopened = js(web, @"window.moves");
    NSMutableDictionary *report = [result mutableCopy];
    report[@"reopenedMoves"] = reopened;
    report[@"editorKeptKey"] = @(editorKeptKey);
    NSData *json = [NSJSONSerialization dataWithJSONObject:report options:NSJSONWritingPrettyPrinted error:nil];
    puts([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
    BOOL passed = editorKeptKey && reopened.intValue > 0 && !beforeKey && before.intValue == 0 && header.keyWindow && after.intValue > 0 && foreground == NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
    plvs_macos_dock_window_configure((__bridge void *)main, false, false, 80, true, NULL);
    [header orderOut:nil]; [main orderOut:nil];
    return !passed;
  }
}
