// Measures PCM from the production device-bound Core Audio tap.
#import <CoreAudio/CoreAudio.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

extern void *macos_tap_create(const char *, intptr_t, const uint32_t *, size_t,
                              void (*)(void *, const float *, uint32_t, uint32_t, uint64_t),
                              void *, char *, size_t);
extern void macos_tap_destroy(void *, void **);
extern int macos_uid_for_output_name(const char *, char *, size_t);

typedef struct {
  uint64_t frames;
  uint64_t windows;
  float peak[2];
  float window_peak;
  float min_window_peak;
  uint32_t window_frames;
  uint32_t unexpected_channels;
} Measurement;

static void measure_pcm(void *userdata, const float *samples, uint32_t frames,
                        uint32_t channels, uint64_t host_time) {
  (void)host_time;
  Measurement *measurement = userdata;
  if (channels != 2) {
    measurement->unexpected_channels = channels;
    return;
  }
  for (uint32_t frame = 0; frame < frames; ++frame) {
    float left = fabsf(samples[frame * 2]);
    float right = fabsf(samples[frame * 2 + 1]);
    measurement->peak[0] = fmaxf(measurement->peak[0], left);
    measurement->peak[1] = fmaxf(measurement->peak[1], right);
    measurement->window_peak = fmaxf(measurement->window_peak, left);
    if (++measurement->window_frames == 960) {
      if (measurement->windows++ > 5) {
        measurement->min_window_peak = fminf(measurement->min_window_peak, measurement->window_peak);
      }
      measurement->window_frames = 0;
      measurement->window_peak = 0;
    }
  }
  measurement->frames += frames;
}

static AudioObjectID process_object(pid_t pid) {
  AudioObjectPropertyAddress address = {
      kAudioHardwarePropertyTranslatePIDToProcessObject,
      kAudioObjectPropertyScopeGlobal,
      kAudioObjectPropertyElementMain,
  };
  AudioObjectID process = kAudioObjectUnknown;
  UInt32 size = sizeof(process);
  OSStatus status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, sizeof(pid),
                                              &pid, &size, &process);
  return status == noErr ? process : kAudioObjectUnknown;
}

int main(int argc, char **argv) {
  if (argc < 4 || argc > 5) return 2;
  char uid[1024] = {0};
  bool unbound = strcmp(argv[1], "unbound") == 0;
  if (!unbound && macos_uid_for_output_name(argv[1], uid, sizeof(uid)) != 0) {
    fprintf(stderr, "Could not resolve output %s\n", argv[1]);
    return 1;
  }
  uint32_t objects[2] = {0};
  for (int index = 3; index < argc; ++index) {
    objects[index - 3] = process_object(atoi(argv[index]));
    if (objects[index - 3] == kAudioObjectUnknown) {
      fprintf(stderr, "Core Audio process object is missing for PID %s\n", argv[index]);
      return 1;
    }
  }
  Measurement measurement = {.min_window_peak = INFINITY};
  char error[1024] = {0};
  void *tap = macos_tap_create(unbound ? NULL : uid, 0, objects, (size_t)(argc - 3), measure_pcm, &measurement, error,
                              sizeof(error));
  if (!tap) {
    fprintf(stderr, "%s\n", error);
    return 1;
  }
  sleep((unsigned int)atoi(argv[2]));
  macos_tap_destroy(tap, NULL);
  if (measurement.frames == 0 || measurement.unexpected_channels ||
      !isfinite(measurement.min_window_peak)) {
    fprintf(stderr, "Missing stereo PCM: frames=%llu unexpectedChannels=%u\n",
            measurement.frames, measurement.unexpected_channels);
    return 1;
  }
  printf("{\"frames\":%llu,\"leftPeak\":%.9g,\"rightPeak\":%.9g,\"minLeftWindowPeak\":%.9g}\n",
         measurement.frames, measurement.peak[0], measurement.peak[1], measurement.min_window_peak);
  return 0;
}
