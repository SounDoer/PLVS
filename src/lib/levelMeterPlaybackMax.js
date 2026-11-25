/**
 * Level Meter Playback Max: the highest reading since playback started, where playback starts
 * when signal returns after at least PLAYBACK_SILENCE_HOLD_MS of silence.
 *
 * Pure and free of React, so it runs whether or not a panel is rendered: the Level Meter hooks in
 * `src/hooks/useLevelMeterPlaybackMax.js` wrap it, and anything else that needs the same value
 * (another surface, a device sender) can drive it from frames directly. Trackers are plain
 * objects that the update functions mutate; callers compare the returned value to detect change.
 */

export const PLAYBACK_SIGNAL_FLOOR_DB = -70;
export const PLAYBACK_SILENCE_HOLD_MS = 350;

/**
 * True when any finite reading is above the playback signal floor.
 * @param {number | number[] | null | undefined} values
 */
export function hasPlaybackSignal(values) {
  if (Array.isArray(values)) {
    return values.some((value) => Number.isFinite(value) && value > PLAYBACK_SIGNAL_FLOOR_DB);
  }
  return Number.isFinite(values) && /** @type {number} */ (values) > PLAYBACK_SIGNAL_FLOOR_DB;
}

/**
 * @template T
 * @typedef {{ mode: string | undefined, active: boolean, silentSince: number | null, playbackMax: T }} PlaybackMaxTracker
 */

/**
 * @param {string} [mode]
 * @returns {PlaybackMaxTracker<number>}
 */
export function createPlaybackMaxTracker(mode) {
  return { mode, active: false, silentSince: null, playbackMax: -Infinity };
}

/**
 * @param {string} [mode]
 * @returns {PlaybackMaxTracker<number[]>}
 */
export function createChannelPlaybackMaxTracker(mode) {
  return { mode, active: false, silentSince: null, playbackMax: [] };
}

/**
 * @param {PlaybackMaxTracker<any>} tracker
 * @param {any} empty
 */
function reset(tracker, empty) {
  tracker.active = false;
  tracker.silentSince = null;
  tracker.playbackMax = empty;
}

/**
 * @param {PlaybackMaxTracker<any>} tracker
 * @param {number} nowMs
 */
function silenceElapsed(tracker, nowMs) {
  return tracker.silentSince != null && nowMs - tracker.silentSince >= PLAYBACK_SILENCE_HOLD_MS;
}

/**
 * Advances a single-value tracker by one frame. Playback is detected from `audible` (the frame's
 * per-channel peaks in the Level Meter), while the maximum follows `value`. The maximum is held
 * through silence and restarts with the next playback.
 *
 * @param {PlaybackMaxTracker<number>} tracker
 * @param {{ enabled: boolean, mode?: string, audible: boolean, value: number, nowMs: number }} frame
 * @returns {number} the Playback Max, or -Infinity when there is none
 */
export function updatePlaybackMax(tracker, { enabled, mode, audible, value, nowMs }) {
  if (tracker.mode !== mode) {
    tracker.mode = mode;
    reset(tracker, -Infinity);
  }
  if (!enabled) {
    reset(tracker, -Infinity);
    return tracker.playbackMax;
  }
  if (audible) {
    const startsNewPlayback = !tracker.active || silenceElapsed(tracker, nowMs);
    tracker.active = true;
    tracker.silentSince = null;
    const next = startsNewPlayback
      ? value
      : Number.isFinite(value)
        ? Math.max(tracker.playbackMax, value)
        : tracker.playbackMax;
    tracker.playbackMax = Number.isFinite(next) ? next : -Infinity;
    return tracker.playbackMax;
  }
  if (tracker.active && tracker.silentSince == null) tracker.silentSince = nowMs;
  return tracker.playbackMax;
}

/**
 * Advances a per-channel tracker by one frame. Playback is detected from the values themselves.
 * Unlike the single-value tracker, the maxima clear once silence has lasted
 * PLAYBACK_SILENCE_HOLD_MS.
 *
 * @param {PlaybackMaxTracker<number[]>} tracker
 * @param {{ enabled: boolean, mode?: string, values: number[] | null | undefined, nowMs: number }} frame
 * @returns {number[]} per-channel Playback Max, -Infinity where there is none; empty when cleared
 */
export function updateChannelPlaybackMax(tracker, { enabled, mode, values, nowMs }) {
  if (tracker.mode !== mode) {
    tracker.mode = mode;
    reset(tracker, []);
  }
  if (!enabled) {
    reset(tracker, []);
    return tracker.playbackMax;
  }
  const elapsed = silenceElapsed(tracker, nowMs);
  if (hasPlaybackSignal(values) && Array.isArray(values)) {
    const startsNewPlayback = !tracker.active || elapsed;
    tracker.active = true;
    tracker.silentSince = null;
    tracker.playbackMax = values.map((value, index) => {
      if (startsNewPlayback) return Number.isFinite(value) ? value : -Infinity;
      const previous = Number.isFinite(tracker.playbackMax[index])
        ? tracker.playbackMax[index]
        : -Infinity;
      return Number.isFinite(value) ? Math.max(previous, value) : previous;
    });
    return tracker.playbackMax;
  }
  if (tracker.active) {
    if (tracker.silentSince == null) {
      tracker.silentSince = nowMs;
    } else if (elapsed) {
      reset(tracker, []);
    }
  }
  return tracker.playbackMax;
}
