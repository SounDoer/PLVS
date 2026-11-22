#import <AppKit/AppKit.h>

// Orders a PLVS window above other normal windows so its WebView renders again, without
// activating PLVS or making the window key: keyboard focus stays with the user's current app.
// Callers run this on the main thread.
void plvs_macos_reveal_without_focus(void *raw) {
  NSWindow *window = (__bridge NSWindow *)raw;
  if (!window.miniaturized) {
    [window orderFrontRegardless];
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
