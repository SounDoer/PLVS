#import <AppKit/AppKit.h>
#import <AudioToolbox/AudioToolbox.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreImage/CoreImage.h>
#import <CoreGraphics/CGWindow.h>
#import <ImageIO/ImageIO.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <WebKit/WebKit.h>

#import <math.h>
#import <stdint.h>
#import <string.h>

typedef void (*PLVSVisualSnapshotCallback)(void *context, int32_t status, uint32_t width,
                                           uint32_t height, const char *message);
typedef void (*PLVSVisualRecordingCallback)(void *context, int32_t event, uint64_t value,
                                            const char *message);

enum {
  PLVS_VISUAL_SNAPSHOT_OK = 0,
  PLVS_VISUAL_SNAPSHOT_TARGET_UNAVAILABLE = 1,
  PLVS_VISUAL_SNAPSHOT_CAPTURE_FAILED = 2,
  PLVS_VISUAL_SNAPSHOT_ARTIFACT_WRITE_FAILED = 3,
};

bool plvs_macos_screen_capture_preflight(void) {
  return CGPreflightScreenCaptureAccess();
}

bool plvs_macos_screen_capture_request(void) {
  return CGRequestScreenCaptureAccess();
}

enum {
  PLVS_VISUAL_RECORDING_STARTED = 0,
  PLVS_VISUAL_RECORDING_FRAME = 1,
  PLVS_VISUAL_RECORDING_DROPPED = 2,
  PLVS_VISUAL_RECORDING_DURATION_LIMIT = 3,
  PLVS_VISUAL_RECORDING_SIZE_LIMIT = 4,
  PLVS_VISUAL_RECORDING_COMPLETED = 5,
  PLVS_VISUAL_RECORDING_FAILED = 6,
  PLVS_VISUAL_RECORDING_TIMELINE = 7,
};

@interface PLVSMacRecordingSession : NSObject <SCStreamOutput, SCStreamDelegate>
- (instancetype)initWithWebView:(WKWebView *)webview
                            path:(NSString *)path
                           width:(uint32_t)width
                          height:(uint32_t)height
                             fps:(uint32_t)fps
                     maxDuration:(uint32_t)maxDuration
                               x:(double)x
                               y:(double)y
                       rectWidth:(double)rectWidth
                      rectHeight:(double)rectHeight
                   viewportWidth:(double)viewportWidth
                  viewportHeight:(double)viewportHeight
                      showCursor:(BOOL)showCursor
                         hasAudio:(BOOL)hasAudio
                         context:(void *)context
                        callback:(PLVSVisualRecordingCallback)callback;
- (void)start;
- (void)requestStop;
- (int32_t)appendAudioData:(NSData *)data startFrame:(uint64_t)startFrame;
- (void)updateX:(double)x
               y:(double)y
       rectWidth:(double)rectWidth
      rectHeight:(double)rectHeight
   viewportWidth:(double)viewportWidth
  viewportHeight:(double)viewportHeight;
@end

@interface PLVSMacRecordingSession ()
@property(nonatomic, weak) WKWebView *webview;
@property(nonatomic, copy) NSString *path;
@property(nonatomic) uint32_t outputWidth;
@property(nonatomic) uint32_t outputHeight;
@property(nonatomic) uint32_t fps;
@property(nonatomic) uint32_t maxDuration;
@property(nonatomic) BOOL showCursor;
@property(nonatomic) BOOL hasAudio;
@property(nonatomic) CGRect normalizedTarget;
@property(nonatomic) CGRect windowFrame;
@property(nonatomic) dispatch_queue_t queue;
@property(nonatomic) SCStream *stream;
@property(nonatomic) AVAssetWriter *writer;
@property(nonatomic) AVAssetWriterInput *videoInput;
@property(nonatomic) AVAssetWriterInput *audioInput;
@property(nonatomic) CMAudioFormatDescriptionRef audioFormat;
@property(nonatomic) AVAssetWriterInputPixelBufferAdaptor *adaptor;
@property(nonatomic) CIContext *ciContext;
@property(nonatomic) CMTime firstTime;
@property(nonatomic) BOOL writerStarted;
@property(nonatomic) BOOL streamStarted;
@property(nonatomic) BOOL stopping;
@property(nonatomic) BOOL terminal;
@property(nonatomic) BOOL limitSignaled;
@property(nonatomic) void *callbackContext;
@property(nonatomic) PLVSVisualRecordingCallback callback;
@end

@implementation PLVSMacRecordingSession

- (void)dealloc {
  if (_audioFormat) CFRelease(_audioFormat);
}

- (instancetype)initWithWebView:(WKWebView *)webview
                            path:(NSString *)path
                           width:(uint32_t)width
                          height:(uint32_t)height
                             fps:(uint32_t)fps
                     maxDuration:(uint32_t)maxDuration
                               x:(double)x
                               y:(double)y
                       rectWidth:(double)rectWidth
                      rectHeight:(double)rectHeight
                   viewportWidth:(double)viewportWidth
                  viewportHeight:(double)viewportHeight
                      showCursor:(BOOL)showCursor
                         hasAudio:(BOOL)hasAudio
                         context:(void *)context
                        callback:(PLVSVisualRecordingCallback)callback {
  self = [super init];
  if (self) {
    _webview = webview;
    _path = [path copy];
    _outputWidth = width;
    _outputHeight = height;
    _fps = fps;
    _maxDuration = maxDuration;
    _showCursor = showCursor;
    _hasAudio = hasAudio;
    _callbackContext = context;
    _callback = callback;
    _firstTime = kCMTimeInvalid;
    _queue = dispatch_queue_create("com.plvs.visual-recording", DISPATCH_QUEUE_SERIAL);
    _ciContext = [CIContext contextWithOptions:@{kCIContextUseSoftwareRenderer : @NO}];
    [self setGeometryX:x y:y rectWidth:rectWidth rectHeight:rectHeight
         viewportWidth:viewportWidth viewportHeight:viewportHeight];
  }
  return self;
}

- (void)emit:(int32_t)event value:(uint64_t)value message:(NSString *)message {
  if (!_callback) return;
  const char *utf8 = message.length > 0 ? message.UTF8String : "";
  _callback(_callbackContext, event, value, utf8 ?: "");
}

- (void)setGeometryX:(double)x
                    y:(double)y
            rectWidth:(double)rectWidth
           rectHeight:(double)rectHeight
        viewportWidth:(double)viewportWidth
       viewportHeight:(double)viewportHeight {
  if (!isfinite(x) || !isfinite(y) || !isfinite(rectWidth) || !isfinite(rectHeight) ||
      !isfinite(viewportWidth) || !isfinite(viewportHeight) || rectWidth <= 0 || rectHeight <= 0 ||
      viewportWidth <= 0 || viewportHeight <= 0) return;
  NSWindow *window = _webview.window;
  if (!window) return;
  CGRect webviewInWindow = [_webview convertRect:_webview.bounds toView:nil];
  CGRect webviewOnScreen = [window convertRectToScreen:webviewInWindow];
  CGRect contentOnScreen = [window convertRectToScreen:window.contentLayoutRect];
  webviewOnScreen = CGRectIntersection(webviewOnScreen, contentOnScreen);
  if (CGRectIsEmpty(webviewOnScreen)) return;
  CGRect frame = window.frame;
  CGRect targetOnScreen = CGRectMake(
      webviewOnScreen.origin.x + (x / viewportWidth) * webviewOnScreen.size.width,
      webviewOnScreen.origin.y + (1.0 - ((y + rectHeight) / viewportHeight)) * webviewOnScreen.size.height,
      (rectWidth / viewportWidth) * webviewOnScreen.size.width,
      (rectHeight / viewportHeight) * webviewOnScreen.size.height);
  _normalizedTarget = CGRectMake(
      (targetOnScreen.origin.x - frame.origin.x) / frame.size.width,
      (targetOnScreen.origin.y - frame.origin.y) / frame.size.height,
      targetOnScreen.size.width / frame.size.width, targetOnScreen.size.height / frame.size.height);
  _windowFrame = frame;
}

- (void)updateX:(double)x
               y:(double)y
       rectWidth:(double)rectWidth
      rectHeight:(double)rectHeight
   viewportWidth:(double)viewportWidth
  viewportHeight:(double)viewportHeight {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSWindow *window = self.webview.window;
    if (!window) return;
    CGRect webviewInWindow = [self.webview convertRect:self.webview.bounds toView:nil];
    CGRect webviewOnScreen = [window convertRectToScreen:webviewInWindow];
    CGRect contentOnScreen = [window convertRectToScreen:window.contentLayoutRect];
    webviewOnScreen = CGRectIntersection(webviewOnScreen, contentOnScreen);
    if (CGRectIsEmpty(webviewOnScreen)) return;
    CGRect windowFrame = window.frame;
    CGRect targetOnScreen = CGRectMake(
        webviewOnScreen.origin.x + (x / viewportWidth) * webviewOnScreen.size.width,
        webviewOnScreen.origin.y + (1.0 - ((y + rectHeight) / viewportHeight)) * webviewOnScreen.size.height,
        (rectWidth / viewportWidth) * webviewOnScreen.size.width,
        (rectHeight / viewportHeight) * webviewOnScreen.size.height);
    CGRect normalized = CGRectMake(
        (targetOnScreen.origin.x - windowFrame.origin.x) / windowFrame.size.width,
        (targetOnScreen.origin.y - windowFrame.origin.y) / windowFrame.size.height,
        targetOnScreen.size.width / windowFrame.size.width,
        targetOnScreen.size.height / windowFrame.size.height);
    dispatch_async(self.queue, ^{
      self.normalizedTarget = normalized;
      self.windowFrame = windowFrame;
    });
  });
}

- (void)fail:(NSString *)message {
  if (_terminal) return;
  _terminal = YES;
  [_writer cancelWriting];
  [self emit:PLVS_VISUAL_RECORDING_FAILED value:0 message:message];
}

- (void)start {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSWindow *window = self.webview.window;
    if (!window) {
      dispatch_async(self.queue, ^{ [self fail:@"The PLVS main window is unavailable."]; });
      return;
    }
    CGWindowID windowID = (CGWindowID)window.windowNumber;
    CGFloat scale = window.backingScaleFactor;
    size_t captureWidth = MAX(2, (size_t)llround(window.frame.size.width * scale));
    size_t captureHeight = MAX(2, (size_t)llround(window.frame.size.height * scale));
    self.windowFrame = window.frame;
    [SCShareableContent getShareableContentExcludingDesktopWindows:YES
                                               onScreenWindowsOnly:YES
                                                completionHandler:^(SCShareableContent *content,
                                                                    NSError *error) {
      dispatch_async(self.queue, ^{
        if (error) { [self fail:error.localizedDescription]; return; }
        SCWindow *source = nil;
        for (SCWindow *candidate in content.windows) {
          if (candidate.windowID == windowID &&
              candidate.owningApplication.processID == NSRunningApplication.currentApplication.processIdentifier) {
            source = candidate;
            break;
          }
        }
        if (!source) { [self fail:@"The PLVS main window is not available to ScreenCaptureKit."]; return; }

        [[NSFileManager defaultManager] removeItemAtPath:self.path error:nil];
        NSError *writerError = nil;
        NSURL *url = [NSURL fileURLWithPath:self.path];
        self.writer = [[AVAssetWriter alloc] initWithURL:url fileType:AVFileTypeMPEG4 error:&writerError];
        if (!self.writer) { [self fail:writerError.localizedDescription ?: @"The MP4 writer could not start."]; return; }
        uint64_t requestedBitrate = (uint64_t)self.outputWidth * self.outputHeight * self.fps / 8;
        NSDictionary *compression = @{ AVVideoAverageBitRateKey : @(MAX(UINT64_C(1000000), requestedBitrate)) };
        NSDictionary *settings = @{
          AVVideoCodecKey : AVVideoCodecTypeH264,
          AVVideoWidthKey : @(self.outputWidth),
          AVVideoHeightKey : @(self.outputHeight),
          AVVideoCompressionPropertiesKey : compression,
        };
        self.videoInput = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo
                                                             outputSettings:settings];
        self.videoInput.expectsMediaDataInRealTime = YES;
        NSDictionary *attributes = @{
          (NSString *)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
          (NSString *)kCVPixelBufferWidthKey : @(self.outputWidth),
          (NSString *)kCVPixelBufferHeightKey : @(self.outputHeight),
          (NSString *)kCVPixelBufferIOSurfacePropertiesKey : @{},
        };
        self.adaptor = [AVAssetWriterInputPixelBufferAdaptor
            assetWriterInputPixelBufferAdaptorWithAssetWriterInput:self.videoInput
                                        sourcePixelBufferAttributes:attributes];
        if (![self.writer canAddInput:self.videoInput]) { [self fail:@"The MP4 writer rejected the H.264 input."]; return; }
        [self.writer addInput:self.videoInput];
        if (self.hasAudio) {
          NSDictionary *audioSettings = @{
            AVFormatIDKey : @(kAudioFormatMPEG4AAC),
            AVSampleRateKey : @48000,
            AVNumberOfChannelsKey : @2,
            AVEncoderBitRateKey : @192000,
          };
          self.audioInput = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeAudio
                                                                outputSettings:audioSettings];
          self.audioInput.expectsMediaDataInRealTime = YES;
          if (![self.writer canAddInput:self.audioInput]) {
            [self fail:@"The MP4 writer rejected the AAC input."];
            return;
          }
          [self.writer addInput:self.audioInput];
          AudioStreamBasicDescription pcm = {0};
          pcm.mSampleRate = 48000;
          pcm.mFormatID = kAudioFormatLinearPCM;
          pcm.mFormatFlags = kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked;
          pcm.mBytesPerPacket = 4;
          pcm.mFramesPerPacket = 1;
          pcm.mBytesPerFrame = 4;
          pcm.mChannelsPerFrame = 2;
          pcm.mBitsPerChannel = 16;
          OSStatus formatStatus = CMAudioFormatDescriptionCreate(
              kCFAllocatorDefault, &pcm, 0, NULL, 0, NULL, NULL, &_audioFormat);
          if (formatStatus != noErr || !self.audioFormat) {
            [self fail:@"The PCM audio format could not be created."];
            return;
          }
        }

        SCContentFilter *filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:source];
        SCStreamConfiguration *configuration = [[SCStreamConfiguration alloc] init];
        configuration.width = captureWidth;
        configuration.height = captureHeight;
        configuration.minimumFrameInterval = CMTimeMake(1, self.fps);
        configuration.queueDepth = 3;
        configuration.pixelFormat = kCVPixelFormatType_32BGRA;
        configuration.showsCursor = self.showCursor;
        configuration.capturesAudio = NO;
        configuration.scalesToFit = YES;
        configuration.ignoreShadowsSingleWindow = YES;
        self.stream = [[SCStream alloc] initWithFilter:filter configuration:configuration delegate:self];
        NSError *outputError = nil;
        if (![self.stream addStreamOutput:self type:SCStreamOutputTypeScreen
                       sampleHandlerQueue:self.queue error:&outputError]) {
          [self fail:outputError.localizedDescription ?: @"ScreenCaptureKit rejected the video output."];
          return;
        }
        [self.stream startCaptureWithCompletionHandler:^(NSError *startError) {
          dispatch_async(self.queue, ^{
            if (startError) { [self fail:startError.localizedDescription]; return; }
            self.streamStarted = YES;
            [self emit:PLVS_VISUAL_RECORDING_STARTED value:0 message:@""];
            if (self.stopping) [self stopStreamAndFinish];
          });
        }];
      });
    }];
  });
}

- (CGRect)pixelCropForBuffer:(CVPixelBufferRef)buffer {
  CGFloat bufferWidth = CVPixelBufferGetWidth(buffer);
  CGFloat bufferHeight = CVPixelBufferGetHeight(buffer);
  CGRect target = _normalizedTarget;
  CGFloat left = MAX(0, MIN(bufferWidth, target.origin.x * bufferWidth));
  CGFloat right = MAX(left, MIN(bufferWidth, CGRectGetMaxX(target) * bufferWidth));
  CGFloat bottom = MAX(0, MIN(bufferHeight, target.origin.y * bufferHeight));
  CGFloat top = MAX(bottom, MIN(bufferHeight, CGRectGetMaxY(target) * bufferHeight));
  return CGRectMake(floor(left), floor(bottom), ceil(right) - floor(left),
                    ceil(top) - floor(bottom));
}

- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
         ofType:(SCStreamOutputType)type {
  if (type != SCStreamOutputTypeScreen || _terminal || _stopping || !CMSampleBufferIsValid(sampleBuffer)) return;
  CVPixelBufferRef source = CMSampleBufferGetImageBuffer(sampleBuffer);
  if (!source) { [self emit:PLVS_VISUAL_RECORDING_DROPPED value:1 message:@""]; return; }
  CMTime sourceTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer);
  if (!CMTIME_IS_VALID(_firstTime)) _firstTime = sourceTime;
  CMTime relative = CMTimeSubtract(sourceTime, _firstTime);
  if (CMTimeGetSeconds(relative) >= _maxDuration) {
    if (!_limitSignaled) {
      _limitSignaled = YES;
      [self emit:PLVS_VISUAL_RECORDING_DURATION_LIMIT value:0 message:@""];
      if (!_hasAudio) [self requestStop];
    }
    return;
  }
  if (!_writerStarted) {
    if (![_writer startWriting]) { [self fail:_writer.error.localizedDescription ?: @"The MP4 writer failed to start."]; return; }
    [_writer startSessionAtSourceTime:kCMTimeZero];
    _writerStarted = YES;
  }
  if (!_videoInput.readyForMoreMediaData) {
    [self emit:PLVS_VISUAL_RECORDING_DROPPED value:1 message:@""];
    return;
  }
  CVPixelBufferRef destination = NULL;
  CVReturn result = CVPixelBufferPoolCreatePixelBuffer(NULL, _adaptor.pixelBufferPool, &destination);
  if (result != kCVReturnSuccess || !destination) {
    [self emit:PLVS_VISUAL_RECORDING_DROPPED value:1 message:@""];
    return;
  }
  CGRect crop = [self pixelCropForBuffer:source];
  if (crop.size.width < 1 || crop.size.height < 1) {
    CVPixelBufferRelease(destination);
    [self fail:@"The recording target left the captured window."];
    return;
  }
  CIImage *cropped = [[CIImage imageWithCVPixelBuffer:source] imageByCroppingToRect:crop];
  CGFloat scale = MIN((CGFloat)_outputWidth / crop.size.width, (CGFloat)_outputHeight / crop.size.height);
  CIImage *fitted = [cropped imageByApplyingTransform:
      CGAffineTransformMakeTranslation(-crop.origin.x, -crop.origin.y)];
  fitted = [fitted imageByApplyingTransform:CGAffineTransformMakeScale(scale, scale)];
  CGFloat fittedWidth = crop.size.width * scale;
  CGFloat fittedHeight = crop.size.height * scale;
  fitted = [fitted imageByApplyingTransform:CGAffineTransformMakeTranslation(
      ((CGFloat)_outputWidth - fittedWidth) / 2.0, ((CGFloat)_outputHeight - fittedHeight) / 2.0)];
  CGRect canvas = CGRectMake(0, 0, _outputWidth, _outputHeight);
  CIImage *black = [[CIImage imageWithColor:[CIColor colorWithRed:0 green:0 blue:0 alpha:1]]
      imageByCroppingToRect:canvas];
  CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
  [_ciContext render:[fitted imageByCompositingOverImage:black]
      toCVPixelBuffer:destination bounds:canvas colorSpace:colorSpace];
  CGColorSpaceRelease(colorSpace);
  BOOL appended = [_adaptor appendPixelBuffer:destination withPresentationTime:relative];
  CVPixelBufferRelease(destination);
  if (!appended) { [self fail:_writer.error.localizedDescription ?: @"The H.264 encoder rejected a frame."]; return; }
  NSDictionary *attributes = [[NSFileManager defaultManager] attributesOfItemAtPath:_path error:nil];
  CMTime videoEnd = CMTimeAdd(relative, CMTimeMake(1, self.fps));
  CMTime audioClock = CMTimeConvertScale(videoEnd, 48000, kCMTimeRoundingMethod_RoundTowardZero);
  [self emit:PLVS_VISUAL_RECORDING_TIMELINE value:(uint64_t)MAX(0, audioClock.value) message:@""];
  [self emit:PLVS_VISUAL_RECORDING_FRAME value:attributes.fileSize message:@""];
  if (attributes.fileSize >= UINT64_C(2) * 1024 * 1024 * 1024) {
    if (!_limitSignaled) {
      _limitSignaled = YES;
      [self emit:PLVS_VISUAL_RECORDING_SIZE_LIMIT value:0 message:@""];
      if (!_hasAudio) [self requestStop];
    }
  }
}

- (int32_t)appendAudioData:(NSData *)data startFrame:(uint64_t)startFrame {
  if (!_hasAudio || !_writerStarted || _stopping || _terminal || !_audioFormat) return 1;
  if (!_audioInput.readyForMoreMediaData) return 1;
  size_t sampleCount = data.length / 4;
  if (sampleCount == 0) return 0;
  CMBlockBufferRef block = NULL;
  OSStatus blockStatus = CMBlockBufferCreateWithMemoryBlock(
      kCFAllocatorDefault, NULL, data.length, kCFAllocatorDefault, NULL, 0, data.length, 0, &block);
  if (blockStatus != kCMBlockBufferNoErr || !block) {
    [self fail:@"The PCM audio buffer could not be allocated."];
    return 2;
  }
  blockStatus = CMBlockBufferReplaceDataBytes(data.bytes, block, 0, data.length);
  if (blockStatus != kCMBlockBufferNoErr) {
    CFRelease(block);
    [self fail:@"The PCM audio buffer could not be copied."];
    return 2;
  }
  CMSampleTimingInfo timing = {
    .duration = CMTimeMake(1, 48000),
    .presentationTimeStamp = CMTimeMake((int64_t)MIN(startFrame, INT64_MAX), 48000),
    .decodeTimeStamp = kCMTimeInvalid,
  };
  CMSampleBufferRef sample = NULL;
  OSStatus sampleStatus = CMSampleBufferCreateReady(
      kCFAllocatorDefault, block, _audioFormat, sampleCount, 1, &timing, 0, NULL, &sample);
  CFRelease(block);
  if (sampleStatus != noErr || !sample) {
    [self fail:@"The PCM audio sample could not be created."];
    return 2;
  }
  BOOL appended = [_audioInput appendSampleBuffer:sample];
  CFRelease(sample);
  if (!appended) {
    [self fail:_writer.error.localizedDescription ?: @"The AAC encoder rejected an audio packet."];
    return 2;
  }
  return 0;
}

- (void)requestStop {
  dispatch_async(_queue, ^{
    if (self.terminal || self.stopping) return;
    self.stopping = YES;
    if (self.streamStarted) [self stopStreamAndFinish];
  });
}

- (void)stopStreamAndFinish {
  [_stream stopCaptureWithCompletionHandler:^(NSError *error) {
    dispatch_async(self.queue, ^{
      if (error) { [self fail:error.localizedDescription]; return; }
      [self.videoInput markAsFinished];
      [self.audioInput markAsFinished];
      if (!self.writerStarted) {
        if (![self.writer startWriting]) { [self fail:self.writer.error.localizedDescription]; return; }
        [self.writer startSessionAtSourceTime:kCMTimeZero];
      }
      [self.writer finishWritingWithCompletionHandler:^{
        dispatch_async(self.queue, ^{
          if (self.writer.status == AVAssetWriterStatusCompleted) {
            if (!self.terminal) {
              self.terminal = YES;
              NSDictionary *attributes = [[NSFileManager defaultManager] attributesOfItemAtPath:self.path error:nil];
              [self emit:PLVS_VISUAL_RECORDING_COMPLETED value:attributes.fileSize message:@""];
            }
          } else {
            [self fail:self.writer.error.localizedDescription ?: @"The MP4 writer could not finalize the recording."];
          }
        });
      }];
    });
  }];
}

- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
  dispatch_async(_queue, ^{ [self fail:error.localizedDescription ?: @"ScreenCaptureKit stopped unexpectedly."]; });
}
@end

void *plvs_macos_recording_start(void *raw_webview, const uint8_t *path_bytes, size_t path_length,
                                 uint32_t width, uint32_t height, uint32_t fps,
                                 uint32_t max_duration, double x, double y, double rect_width,
                                 double rect_height, double viewport_width, double viewport_height,
                                 bool show_cursor, bool has_audio, void *context,
                                 PLVSVisualRecordingCallback callback) {
  if (!raw_webview || !path_bytes || path_length == 0 || !callback) return NULL;
  NSString *path = [[NSString alloc] initWithBytes:path_bytes length:path_length
                                         encoding:NSUTF8StringEncoding];
  if (!path) return NULL;
  PLVSMacRecordingSession *session = [[PLVSMacRecordingSession alloc]
      initWithWebView:(__bridge WKWebView *)raw_webview path:path width:width height:height fps:fps
      maxDuration:max_duration x:x y:y rectWidth:rect_width rectHeight:rect_height
      viewportWidth:viewport_width viewportHeight:viewport_height showCursor:show_cursor
      hasAudio:has_audio context:context callback:callback];
  [session start];
  return (__bridge_retained void *)session;
}

void plvs_macos_recording_stop(void *raw_session) {
  if (raw_session) [(__bridge PLVSMacRecordingSession *)raw_session requestStop];
}

int32_t plvs_macos_recording_append_audio(void *raw_session, const int16_t *samples,
                                          size_t sample_count, uint64_t start_frame) {
  if (!raw_session || (!samples && sample_count > 0)) return 2;
  NSData *data = [NSData dataWithBytes:samples length:sample_count * sizeof(int16_t)];
  __block int32_t status = 2;
  PLVSMacRecordingSession *session = (__bridge PLVSMacRecordingSession *)raw_session;
  dispatch_sync(session.queue, ^{ status = [session appendAudioData:data startFrame:start_frame]; });
  return status;
}

void plvs_macos_recording_update_geometry(void *raw_session, double x, double y,
                                          double rect_width, double rect_height,
                                          double viewport_width, double viewport_height) {
  if (raw_session) {
    [(__bridge PLVSMacRecordingSession *)raw_session updateX:x y:y rectWidth:rect_width
        rectHeight:rect_height viewportWidth:viewport_width viewportHeight:viewport_height];
  }
}

void plvs_macos_recording_release(void *raw_session) {
  if (raw_session) CFBridgingRelease(raw_session);
}

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
