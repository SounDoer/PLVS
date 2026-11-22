#import <AppKit/AppKit.h>

// Restores a minimized PLVS window and, when `raise` is set, orders it above other normal windows
// so its WebView renders again. Never activates PLVS or makes the window key: keyboard focus stays
// with the user's current app. Callers run this on the main thread.
void plvs_macos_reveal_without_focus(void *raw, bool raise) {
  NSWindow *window = (__bridge NSWindow *)raw;
  if (!window.miniaturized) {
    if (raise) [window orderFrontRegardless];
    return;
  }
  if (!raise) {
    [window deminiaturize:nil];
    return;
  }
  // Reordering during the restore animation leaves WebKit's page hidden; order it front once
  // the window has finished deminiaturizing.
  __block id observer = nil;
  observer = [NSNotificationCenter.defaultCenter
      addObserverForName:NSWindowDidDeminiaturizeNotification
                  object:window
                   queue:NSOperationQueue.mainQueue
              usingBlock:^(NSNotification *note) {
                (void)note;
                [NSNotificationCenter.defaultCenter removeObserver:observer];
                observer = nil;
                [window orderFrontRegardless];
              }];
  [window deminiaturize:nil];
}
