/* eslint-disable react-hooks/exhaustive-deps -- Audio frame effects intentionally publish tracker state from stable value keys. */
import { useEffect, useRef, useState } from "react";
import {
  createChannelPlaybackMaxTracker,
  createPlaybackMaxTracker,
  hasPlaybackSignal,
  updateChannelPlaybackMax,
  updatePlaybackMax,
} from "../lib/levelMeterPlaybackMax.js";

// React adapters for src/lib/levelMeterPlaybackMax.js, which owns the tracking rules. They
// publish a new value only when the tracker's value changes.

export function useLevelMeterPlaybackMax({ enabled, mode, value, displayAudio }) {
  const [playbackMax, setPlaybackMax] = useState(-Infinity);
  const trackerRef = useRef(createPlaybackMaxTracker(mode));

  const signalKey = Array.isArray(displayAudio?.peakDb) ? displayAudio.peakDb.join("|") : "";

  useEffect(() => {
    const tracker = trackerRef.current;
    const previous = tracker.playbackMax;
    const next = updatePlaybackMax(tracker, {
      enabled,
      mode,
      audible: hasPlaybackSignal(displayAudio?.peakDb),
      value,
      nowMs: Date.now(),
    });
    if (!Object.is(next, previous)) setPlaybackMax(next);
  }, [displayAudio, enabled, mode, signalKey, value]);

  return playbackMax;
}

export function useLevelMeterPlaybackMaxChannels({ enabled, mode, values }) {
  const [playbackMax, setPlaybackMax] = useState([]);
  const trackerRef = useRef(createChannelPlaybackMaxTracker(mode));
  const valuesKey = Array.isArray(values) ? values.join("|") : "";

  useEffect(() => {
    const tracker = trackerRef.current;
    const previous = tracker.playbackMax;
    const next = updateChannelPlaybackMax(tracker, { enabled, mode, values, nowMs: Date.now() });
    const changed =
      next.length !== previous.length ||
      next.some((value, index) => !Object.is(value, previous[index]));
    if (changed) setPlaybackMax(next);
  }, [enabled, mode, valuesKey]);

  return playbackMax;
}
