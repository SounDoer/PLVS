// Core Audio process tap + private aggregate + IOProc (macOS 14.2+).
// PCM is forwarded to Rust via pcm_bridge (same crate, #[no_mangle]).
//
// Requires Xcode / macOS SDK with Core Audio tap APIs (CATapDescription, AudioHardwareCreateProcessTap).

#import <Foundation/Foundation.h>
#import <CoreFoundation/CoreFoundation.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreAudio/AudioHardware.h>
#if !__has_include(<CoreAudio/CATapDescription.h>)
#error "CoreAudio/CATapDescription.h not found — install Xcode 15+ (or CLT) with macOS 14.2+ SDK."
#endif
#import <CoreAudio/CATapDescription.h>
#import <AudioToolbox/AudioToolbox.h>

#import <stdint.h>
#import <stdio.h>
#import <stdlib.h>
#import <string.h>

// Implemented in Rust (src/audio/macos/pcm_shim.rs).
extern void pcm_bridge(void *userdata, const float *samples, uint32_t frame_count,
                                  uint32_t channels);

#pragma mark - UID lookup

static CFStringRef cfstr_from_cstr(const char *s) {
  if (!s) return NULL;
  return CFStringCreateWithCString(kCFAllocatorDefault, s, kCFStringEncodingUTF8);
}

static OSStatus get_cf_string_property(AudioObjectID obj, AudioObjectPropertySelector selector,
                                       CFStringRef *out) {
  AudioObjectPropertyAddress addr = {
      .mSelector = selector,
      .mScope = kAudioObjectPropertyScopeGlobal,
      .mElement = kAudioObjectPropertyElementMain,
  };
  UInt32 size = sizeof(CFStringRef);
  return AudioObjectGetPropertyData(obj, &addr, 0, NULL, &size, out);
}

static UInt32 output_channel_count(AudioObjectID deviceID) {
  AudioObjectPropertyAddress addr = {
      .mSelector = kAudioDevicePropertyStreamConfiguration,
      .mScope = kAudioDevicePropertyScopeOutput,
      .mElement = kAudioObjectPropertyElementMain,
  };
  UInt32 propSize = 0;
  if (AudioObjectGetPropertyDataSize(deviceID, &addr, 0, NULL, &propSize) != noErr || propSize == 0) {
    return 0;
  }
  AudioBufferList *bufList = (AudioBufferList *)malloc(propSize);
  if (!bufList) {
    return 0;
  }
  UInt32 useSize = propSize;
  OSStatus st = AudioObjectGetPropertyData(deviceID, &addr, 0, NULL, &useSize, bufList);
  UInt32 ch = 0;
  if (st == noErr) {
    for (UInt32 i = 0; i < bufList->mNumberBuffers; i++) {
      ch += bufList->mBuffers[i].mNumberChannels;
    }
  }
  free(bufList);
  return ch;
}

static int copy_cfstring_utf8(CFStringRef cf, char *out, size_t out_cap) {
  if (!cf || !out || out_cap < 2) {
    return -1;
  }
  if (!CFStringGetCString(cf, out, out_cap, kCFStringEncodingUTF8)) {
    return -1;
  }
  return 0;
}

int macos_uid_for_output_name(const char *name_utf8, char *out_uid, size_t out_cap) {
  if (!name_utf8 || !out_uid || out_cap < 2) {
    return -1;
  }
  NSString *target = @(name_utf8);
  if (!target) {
    return -1;
  }

  AudioObjectPropertyAddress listAddr = {
      .mSelector = kAudioHardwarePropertyDevices,
      .mScope = kAudioObjectPropertyScopeGlobal,
      .mElement = kAudioObjectPropertyElementMain,
  };
  UInt32 dataSize = 0;
  if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &listAddr, 0, NULL, &dataSize) !=
      noErr) {
    return -1;
  }
  UInt32 deviceCount = (UInt32)(dataSize / sizeof(AudioObjectID));
  if (deviceCount == 0) {
    return -1;
  }
  AudioObjectID *devices = (AudioObjectID *)malloc(dataSize);
  if (!devices) {
    return -1;
  }
  if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &listAddr, 0, NULL, &dataSize,
                                 devices) != noErr) {
    free(devices);
    return -1;
  }

  int found = -1;
  for (UInt32 i = 0; i < deviceCount; i++) {
    AudioObjectID dev = devices[i];
    if (output_channel_count(dev) == 0) {
      continue;
    }
    CFStringRef nameCF = NULL;
    if (get_cf_string_property(dev, kAudioObjectPropertyName, &nameCF) != noErr || !nameCF) {
      continue;
    }
    NSString *n = (__bridge NSString *)nameCF;
    if ([n isEqualToString:target]) {
      CFStringRef uidCF = NULL;
      if (get_cf_string_property(dev, kAudioDevicePropertyDeviceUID, &uidCF) == noErr && uidCF) {
        if (copy_cfstring_utf8(uidCF, out_uid, out_cap) == 0) {
          found = 0;
        }
        CFRelease(uidCF);
      }
      CFRelease(nameCF);
      if (found == 0) {
        break;
      }
      continue;
    }
    CFRelease(nameCF);
  }
  free(devices);
  return found;
}

int macos_default_output_uid(char *out_uid, size_t out_cap) {
  if (!out_uid || out_cap < 2) {
    return -1;
  }
  AudioObjectPropertyAddress addr = {
      .mSelector = kAudioHardwarePropertyDefaultOutputDevice,
      .mScope = kAudioObjectPropertyScopeGlobal,
      .mElement = kAudioObjectPropertyElementMain,
  };
  AudioObjectID dev = kAudioObjectUnknown;
  UInt32 size = sizeof(dev);
  if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &addr, 0, NULL, &size, &dev) != noErr ||
      dev == kAudioObjectUnknown) {
    return -1;
  }
  CFStringRef uidCF = NULL;
  if (get_cf_string_property(dev, kAudioDevicePropertyDeviceUID, &uidCF) != noErr || !uidCF) {
    return -1;
  }
  int rc = copy_cfstring_utf8(uidCF, out_uid, out_cap);
  CFRelease(uidCF);
  return rc;
}

#pragma mark - IO proc + tap lifecycle

typedef struct {
  AudioObjectID tap_id;
  AudioObjectID aggregate_id;
  AudioDeviceIOProcID io_proc_id;
  void *pcm_userdata;
  float *interleave_buf;
  size_t interleave_buf_capacity;
} TapHandle;

static OSStatus tap_io_proc(AudioObjectID inDevice, const AudioTimeStamp *inNow,
                             const AudioBufferList *inInputData,
                             const AudioTimeStamp *inInputTime, AudioBufferList *outOutputData,
                             const AudioTimeStamp *inOutputTime, void *inClientData) {
  (void)inDevice;
  (void)inNow;
  (void)outOutputData;
  (void)inOutputTime;
  (void)inInputTime;
  TapHandle *tap = (TapHandle *)inClientData;
  if (!tap || !inInputData || !tap->pcm_userdata) {
    return noErr;
  }

  if (inInputData->mNumberBuffers == 1) {
    const AudioBuffer *buf = &inInputData->mBuffers[0];
    if (!buf->mData || buf->mDataByteSize == 0) {
      return noErr;
    }
    UInt32 channels = buf->mNumberChannels;
    UInt32 frame_count = (UInt32)(buf->mDataByteSize / (channels * sizeof(float)));
    pcm_bridge(tap->pcm_userdata, (const float *)buf->mData, frame_count, channels);
    return noErr;
  }

  // Non-interleaved: verify consistency across buffers, then interleave into scratch buffer.
  UInt32 nbufs = inInputData->mNumberBuffers;
  UInt32 total_ch = 0;
  UInt32 frame_count = 0;
  for (UInt32 i = 0; i < nbufs; i++) {
    const AudioBuffer *buf = &inInputData->mBuffers[i];
    if (!buf->mData || buf->mDataByteSize == 0) {
      return noErr;
    }
    UInt32 ch = buf->mNumberChannels;
    UInt32 fc = (UInt32)(buf->mDataByteSize / (ch * sizeof(float)));
    if (i == 0) {
      frame_count = fc;
    } else if (fc != frame_count) {
      return noErr;
    }
    total_ch += ch;
  }
  if (frame_count == 0 || total_ch == 0) {
    return noErr;
  }
  if ((size_t)frame_count * total_ch > tap->interleave_buf_capacity) {
    return noErr;
  }

  float *dst = tap->interleave_buf;
  UInt32 ch_offset = 0;
  for (UInt32 i = 0; i < nbufs; i++) {
    const AudioBuffer *buf = &inInputData->mBuffers[i];
    UInt32 buf_ch = buf->mNumberChannels;
    const float *src = (const float *)buf->mData;
    for (UInt32 f = 0; f < frame_count; f++) {
      for (UInt32 c = 0; c < buf_ch; c++) {
        dst[f * total_ch + ch_offset + c] = src[f * buf_ch + c];
      }
    }
    ch_offset += buf_ch;
  }

  pcm_bridge(tap->pcm_userdata, tap->interleave_buf, frame_count, total_ch);
  return noErr;
}

void *macos_tap_create(const char *device_uid_utf8, intptr_t stream_index, void *pcm_userdata,
                                  char *err_out, size_t err_cap) {
  if (!device_uid_utf8 || !pcm_userdata) {
    if (err_out && err_cap > 0) {
      snprintf(err_out, err_cap, "missing device uid or pcm context");
    }
    return NULL;
  }

  @autoreleasepool {
    NSString *uid = @(device_uid_utf8);
    if (!uid || uid.length == 0) {
      if (err_out && err_cap > 0) {
        snprintf(err_out, err_cap, "invalid device uid");
      }
      return NULL;
    }

    NSArray *exclude = @[];
    CATapDescription *tapDesc = [[CATapDescription alloc]
        initExcludingProcesses:exclude
                 andDeviceUID:uid
                   withStream:(NSInteger)stream_index];
    if (!tapDesc) {
      if (err_out && err_cap > 0) {
        snprintf(err_out, err_cap, "CATapDescription init failed");
      }
      return NULL;
    }
    [tapDesc setName:@"PLVSTap"];
    [tapDesc setPrivate:YES];
    [tapDesc setMuteBehavior:CATapUnmuted];

    AudioObjectID tap_id = kAudioObjectUnknown;
    OSStatus status = AudioHardwareCreateProcessTap(tapDesc, &tap_id);
    if (status != noErr) {
      if (err_out && err_cap > 0) {
        snprintf(err_out, err_cap, "AudioHardwareCreateProcessTap failed: %d", (int)status);
      }
      return NULL;
    }

    NSString *tapUUID = [tapDesc.UUID UUIDString];
    NSString *aggUidStr = [[NSUUID UUID] UUIDString];

    // Use CoreFoundation APIs: NSDictionary literals + (__bridge NSString *)kAudio* keys
    // can be rejected as "char *" on some SDK / flag combinations.
    CFStringRef kSubTapUID = cfstr_from_cstr(kAudioSubTapUIDKey);
    if (!kSubTapUID) {
      AudioHardwareDestroyProcessTap(tap_id);
      if (err_out && err_cap > 0) {
        snprintf(err_out, err_cap, "failed to create CFString key: kAudioSubTapUIDKey");
      }
      return NULL;
    }
    CFDictionaryRef tapEntry = CFDictionaryCreate(
        kCFAllocatorDefault,
        (const void *[]){kSubTapUID},
        (const void *[]){(__bridge CFStringRef)tapUUID},
        1,
        &kCFTypeDictionaryKeyCallBacks,
        &kCFTypeDictionaryValueCallBacks);
    CFRelease(kSubTapUID);
    if (!tapEntry) {
      AudioHardwareDestroyProcessTap(tap_id);
      if (err_out && err_cap > 0) {
        snprintf(err_out, err_cap, "CFDictionaryCreate(tapEntry) failed");
      }
      return NULL;
    }

    CFArrayRef tapList =
        CFArrayCreate(kCFAllocatorDefault, (const void *[]){tapEntry}, 1, &kCFTypeArrayCallBacks);
    CFRelease(tapEntry);
    if (!tapList) {
      AudioHardwareDestroyProcessTap(tap_id);
      if (err_out && err_cap > 0) {
        snprintf(err_out, err_cap, "CFArrayCreate(tapList) failed");
      }
      return NULL;
    }

    CFStringRef kAggName = cfstr_from_cstr(kAudioAggregateDeviceNameKey);
    CFStringRef kAggUID = cfstr_from_cstr(kAudioAggregateDeviceUIDKey);
    CFStringRef kAggPrivate = cfstr_from_cstr(kAudioAggregateDeviceIsPrivateKey);
    CFStringRef kAggTapList = cfstr_from_cstr(kAudioAggregateDeviceTapListKey);
    CFStringRef kAggTapAutoStart = cfstr_from_cstr(kAudioAggregateDeviceTapAutoStartKey);
    if (!kAggName || !kAggUID || !kAggPrivate || !kAggTapList || !kAggTapAutoStart) {
      if (kAggName) CFRelease(kAggName);
      if (kAggUID) CFRelease(kAggUID);
      if (kAggPrivate) CFRelease(kAggPrivate);
      if (kAggTapList) CFRelease(kAggTapList);
      if (kAggTapAutoStart) CFRelease(kAggTapAutoStart);
      AudioHardwareDestroyProcessTap(tap_id);
      if (err_out && err_cap > 0) {
        snprintf(err_out, err_cap, "failed to create CFString aggregate device keys");
      }
      return NULL;
    }

    const void *aggKeys[] = {
        kAggName,
        kAggUID,
        kAggPrivate,
        kAggTapList,
        kAggTapAutoStart,
    };
    const void *aggValues[] = {
        CFSTR("PLVSTapAggregate"),
        (__bridge CFStringRef)aggUidStr,
        kCFBooleanTrue,
        tapList,
        kCFBooleanTrue,
    };
    CFDictionaryRef aggDesc = CFDictionaryCreate(
        kCFAllocatorDefault, aggKeys, aggValues, 5, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFRelease(kAggName);
    CFRelease(kAggUID);
    CFRelease(kAggPrivate);
    CFRelease(kAggTapList);
    CFRelease(kAggTapAutoStart);
    CFRelease(tapList);
    if (!aggDesc) {
      AudioHardwareDestroyProcessTap(tap_id);
      if (err_out && err_cap > 0) {
        snprintf(err_out, err_cap, "CFDictionaryCreate(aggDesc) failed");
      }
      return NULL;
    }

    AudioObjectID aggregate_id = kAudioObjectUnknown;
    status = AudioHardwareCreateAggregateDevice(aggDesc, &aggregate_id);
    CFRelease(aggDesc);
    if (status != noErr) {
      AudioHardwareDestroyProcessTap(tap_id);
      if (err_out && err_cap > 0) {
        snprintf(err_out, err_cap, "AudioHardwareCreateAggregateDevice failed: %d", (int)status);
      }
      return NULL;
    }

    TapHandle *h = (TapHandle *)calloc(1, sizeof(TapHandle));
    if (!h) {
      AudioHardwareDestroyAggregateDevice(aggregate_id);
      AudioHardwareDestroyProcessTap(tap_id);
      if (err_out && err_cap > 0) {
        snprintf(err_out, err_cap, "calloc failed");
      }
      return NULL;
    }
    h->tap_id = tap_id;
    h->aggregate_id = aggregate_id;
    h->pcm_userdata = pcm_userdata;
    h->interleave_buf_capacity = 2048 * 16;
    h->interleave_buf = (float *)malloc(h->interleave_buf_capacity * sizeof(float));
    if (!h->interleave_buf) {
      AudioHardwareDestroyAggregateDevice(aggregate_id);
      AudioHardwareDestroyProcessTap(tap_id);
      free(h);
      if (err_out && err_cap > 0) {
        snprintf(err_out, err_cap, "failed to allocate interleave scratch buffer");
      }
      return NULL;
    }

    status = AudioDeviceCreateIOProcID(aggregate_id, tap_io_proc, h, &h->io_proc_id);
    if (status != noErr) {
      AudioHardwareDestroyAggregateDevice(aggregate_id);
      AudioHardwareDestroyProcessTap(tap_id);
      free(h);
      if (err_out && err_cap > 0) {
        snprintf(err_out, err_cap, "AudioDeviceCreateIOProcID failed: %d", (int)status);
      }
      return NULL;
    }

    status = AudioDeviceStart(aggregate_id, h->io_proc_id);
    if (status != noErr) {
      AudioDeviceDestroyIOProcID(aggregate_id, h->io_proc_id);
      AudioHardwareDestroyAggregateDevice(aggregate_id);
      AudioHardwareDestroyProcessTap(tap_id);
      free(h);
      if (err_out && err_cap > 0) {
        snprintf(err_out, err_cap, "AudioDeviceStart failed: %d", (int)status);
      }
      return NULL;
    }

    return h;
  }
}

void macos_tap_destroy(void *opaque, void **out_pcm_userdata) {
  TapHandle *h = (TapHandle *)opaque;
  if (!h) {
    if (out_pcm_userdata) {
      *out_pcm_userdata = NULL;
    }
    return;
  }
  if (h->io_proc_id) {
    AudioDeviceStop(h->aggregate_id, h->io_proc_id);
    AudioDeviceDestroyIOProcID(h->aggregate_id, h->io_proc_id);
    h->io_proc_id = NULL;
  }
  if (h->aggregate_id != kAudioObjectUnknown) {
    AudioHardwareDestroyAggregateDevice(h->aggregate_id);
    h->aggregate_id = kAudioObjectUnknown;
  }
  if (h->tap_id != kAudioObjectUnknown) {
    AudioHardwareDestroyProcessTap(h->tap_id);
    h->tap_id = kAudioObjectUnknown;
  }
  if (out_pcm_userdata) {
    *out_pcm_userdata = h->pcm_userdata;
  }
  if (h->interleave_buf) {
    free(h->interleave_buf);
    h->interleave_buf = NULL;
  }
  free(h);
}
