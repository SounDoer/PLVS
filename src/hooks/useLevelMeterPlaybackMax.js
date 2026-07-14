/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- Audio frame effects intentionally publish tracker state from stable value keys. */
import { useEffect, useRef, useState } from "react";

const PLAYBACK_SIGNAL_FLOOR_DB = -70;
const PLAYBACK_SILENCE_HOLD_MS = 350;

function hasPlaybackSignal(displayAudio) {
  const peakDb = displayAudio?.peakDb;
  return Array.isArray(peakDb)
    ? peakDb.some((value) => Number.isFinite(value) && value > PLAYBACK_SIGNAL_FLOOR_DB)
    : false;
}

function hasValueSignal(values) {
  if (Array.isArray(values)) {
    return values.some((value) => Number.isFinite(value) && value > PLAYBACK_SIGNAL_FLOOR_DB);
  }
  return Number.isFinite(values) && values > PLAYBACK_SIGNAL_FLOOR_DB;
}

export function useLevelMeterPlaybackMax({ enabled, mode, value, displayAudio }) {
  const [playbackMax, setPlaybackMax] = useState(-Infinity);
  const trackerRef = useRef({
    mode,
    active: false,
    silentSince: null,
    playbackMax: -Infinity,
  });

  const signalKey = Array.isArray(displayAudio?.peakDb) ? displayAudio.peakDb.join("|") : "";

  useEffect(() => {
    const tracker = trackerRef.current;
    if (tracker.mode !== mode) {
      tracker.mode = mode;
      tracker.active = false;
      tracker.silentSince = null;
      tracker.playbackMax = -Infinity;
      setPlaybackMax(-Infinity);
    }

    if (!enabled) {
      tracker.active = false;
      tracker.silentSince = null;
      tracker.playbackMax = -Infinity;
      setPlaybackMax(-Infinity);
      return;
    }

    const now = Date.now();
    const audible = hasPlaybackSignal(displayAudio);
    const silenceElapsed =
      tracker.silentSince != null && now - tracker.silentSince >= PLAYBACK_SILENCE_HOLD_MS;

    if (audible) {
      const startsNewPlayback = !tracker.active || silenceElapsed;
      tracker.active = true;
      tracker.silentSince = null;
      const nextMax = startsNewPlayback
        ? value
        : Number.isFinite(value)
          ? Math.max(tracker.playbackMax, value)
          : tracker.playbackMax;
      tracker.playbackMax = Number.isFinite(nextMax) ? nextMax : -Infinity;
      setPlaybackMax(tracker.playbackMax);
      return;
    }

    if (tracker.active && tracker.silentSince == null) tracker.silentSince = now;
  }, [displayAudio, enabled, mode, signalKey, value]);

  return playbackMax;
}

export function useLevelMeterPlaybackMaxChannels({ enabled, mode, values }) {
  const [playbackMax, setPlaybackMax] = useState([]);
  const trackerRef = useRef({ mode, active: false, silentSince: null, playbackMax: [] });
  const valuesKey = Array.isArray(values) ? values.join("|") : "";

  useEffect(() => {
    const tracker = trackerRef.current;
    if (tracker.mode !== mode) {
      tracker.mode = mode;
      tracker.active = false;
      tracker.silentSince = null;
      tracker.playbackMax = [];
      setPlaybackMax([]);
    }

    if (!enabled) {
      tracker.active = false;
      tracker.silentSince = null;
      tracker.playbackMax = [];
      setPlaybackMax([]);
      return;
    }

    const now = Date.now();
    const hasSignal = hasValueSignal(values);
    const silenceElapsed =
      tracker.silentSince != null && now - tracker.silentSince >= PLAYBACK_SILENCE_HOLD_MS;
    if (hasSignal) {
      const startsNewPlayback = !tracker.active || silenceElapsed;
      tracker.active = true;
      tracker.silentSince = null;
      const next = values.map((value, index) => {
        if (startsNewPlayback) return Number.isFinite(value) ? value : -Infinity;
        const previous = Number.isFinite(tracker.playbackMax[index])
          ? tracker.playbackMax[index]
          : -Infinity;
        return Number.isFinite(value) ? Math.max(previous, value) : previous;
      });
      const changed =
        next.length !== tracker.playbackMax.length ||
        next.some((value, index) => !Object.is(value, tracker.playbackMax[index]));
      tracker.playbackMax = next;
      if (changed) setPlaybackMax(next);
      return;
    }

    if (tracker.active) {
      if (tracker.silentSince == null) {
        tracker.silentSince = now;
      } else if (silenceElapsed) {
        tracker.active = false;
        tracker.silentSince = null;
        tracker.playbackMax = [];
        setPlaybackMax([]);
      }
    }
  }, [enabled, mode, valuesKey]);

  return playbackMax;
}
