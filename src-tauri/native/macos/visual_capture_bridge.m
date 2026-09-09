#import <AppKit/AppKit.h>
#import <ImageIO/ImageIO.h>
#import <WebKit/WebKit.h>

#import <math.h>
#import <stdint.h>
#import <string.h>

typedef void (*PLVSVisualSnapshotCallback)(void *context, int32_t status, uint32_t width,
                                           uint32_t height, const char *message);

enum {
  PLVS_VISUAL_SNAPSHOT_OK = 0,
  PLVS_VISUAL_SNAPSHOT_TARGET_UNAVAILABLE = 1,
  PLVS_VISUAL_SNAPSHOT_CAPTURE_FAILED = 2,
  PLVS_VISUAL_SNAPSHOT_ARTIFACT_WRITE_FAILED = 3,
};

static void plvs_visual_snapshot_complete(PLVSVisualSnapshotCallback callback, void *context,
                                          int32_t status, uint32_t width, uint32_t height,
                                          NSString *message) {
  const char *utf8 = message.length > 0 ? message.UTF8String : "";
  callback(context, status, width, height, utf8 ?: "");
}

void plvs_macos_capture_webview_png(void *raw_webview, double x, double y, double width,
                                    double height, const uint8_t *path_bytes, size_t path_length,
                                    void *context, PLVSVisualSnapshotCallback callback) {
  if (!callback) return;
  if (!raw_webview || !path_bytes || path_length == 0 || !isfinite(x) || !isfinite(y) ||
      !isfinite(width) || !isfinite(height) || width <= 0.0 || height <= 0.0) {
    plvs_visual_snapshot_complete(callback, context, PLVS_VISUAL_SNAPSHOT_TARGET_UNAVAILABLE, 0, 0,
                                  @"The WebView snapshot geometry is invalid.");
    return;
  }

  NSString *output_path = [[NSString alloc] initWithBytes:path_bytes
                                                    length:path_length
                                                  encoding:NSUTF8StringEncoding];
  if (!output_path) {
    plvs_visual_snapshot_complete(callback, context,
                                  PLVS_VISUAL_SNAPSHOT_ARTIFACT_WRITE_FAILED, 0, 0,
                                  @"The screenshot staging path is invalid.");
    return;
  }

  WKWebView *webview = (__bridge WKWebView *)raw_webview;
  void (^capture)(void) = ^{
    CGRect requested = CGRectMake(x, y, width, height);
    if (!webview.window || !CGRectContainsRect(webview.bounds, requested)) {
      plvs_visual_snapshot_complete(callback, context, PLVS_VISUAL_SNAPSHOT_TARGET_UNAVAILABLE, 0,
                                    0, @"The screenshot target left the WebView bounds.");
      return;
    }

    WKSnapshotConfiguration *configuration = [[WKSnapshotConfiguration alloc] init];
    configuration.rect = requested;
    configuration.afterScreenUpdates = YES;
    [webview takeSnapshotWithConfiguration:configuration
                         completionHandler:^(NSImage *image, NSError *error) {
      if (!image || error) {
        plvs_visual_snapshot_complete(callback, context, PLVS_VISUAL_SNAPSHOT_CAPTURE_FAILED, 0, 0,
                                      error.localizedDescription ?: @"WebKit snapshot failed.");
        return;
      }

      CGRect proposed = CGRectMake(0.0, 0.0, image.size.width, image.size.height);
      CGImageRef borrowed = [image CGImageForProposedRect:&proposed context:nil hints:nil];
      if (!borrowed) {
        plvs_visual_snapshot_complete(callback, context, PLVS_VISUAL_SNAPSHOT_CAPTURE_FAILED, 0, 0,
                                      @"WebKit returned no screenshot bitmap.");
        return;
      }
      CGImageRef captured = CGImageRetain(borrowed);
      dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        @autoreleasepool {
          NSURL *url = [NSURL fileURLWithPath:output_path];
          CGImageDestinationRef destination =
              CGImageDestinationCreateWithURL((__bridge CFURLRef)url, CFSTR("public.png"), 1, NULL);
          if (!destination) {
            CGImageRelease(captured);
            plvs_visual_snapshot_complete(callback, context,
                                          PLVS_VISUAL_SNAPSHOT_ARTIFACT_WRITE_FAILED, 0, 0,
                                          @"The PNG encoder could not open the staging file.");
            return;
          }
          uint32_t pixels_wide = (uint32_t)CGImageGetWidth(captured);
          uint32_t pixels_high = (uint32_t)CGImageGetHeight(captured);
          CGImageDestinationAddImage(destination, captured, NULL);
          bool finalized = CGImageDestinationFinalize(destination);
          CFRelease(destination);
          CGImageRelease(captured);
          if (!finalized) {
            plvs_visual_snapshot_complete(callback, context,
                                          PLVS_VISUAL_SNAPSHOT_ARTIFACT_WRITE_FAILED, 0, 0,
                                          @"The PNG encoder could not finalize the screenshot.");
            return;
          }
          plvs_visual_snapshot_complete(callback, context, PLVS_VISUAL_SNAPSHOT_OK, pixels_wide,
                                        pixels_high, @"");
        }
      });
    }];
  };

  if (NSThread.isMainThread) {
    capture();
  } else {
    dispatch_async(dispatch_get_main_queue(), capture);
  }
}
