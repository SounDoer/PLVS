import { afterEach, describe, expect, it, vi } from "vitest";
import { patchUiState, readUiState, subscribeUiState } from "./uiStore.js";
import { UI_PREFERENCES } from "../uiPreferences.js";

const KEY = UI_PREFERENCES.layoutPersistKey;

describe("uiStore", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("reads an empty object when the blob is absent", () => {
    expect(readUiState()).toEqual({});
  });

  it("reads an empty object when the blob is corrupt JSON", () => {
    localStorage.setItem(KEY, "{not json");
    expect(readUiState()).toEqual({});
  });

  it("reads the parsed blob when present", () => {
    localStorage.setItem(KEY, JSON.stringify({ appearance: "fixed", referenceLufs: -18 }));
    expect(readUiState()).toEqual({ appearance: "fixed", referenceLufs: -18 });
  });

  it("patches a field while preserving the rest of the blob", () => {
    localStorage.setItem(KEY, JSON.stringify({ appearance: "fixed", referenceLufs: -18 }));

    patchUiState({ referenceLufs: -23 });

    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({
      appearance: "fixed",
      referenceLufs: -23,
    });
  });

  it("strips legacy top-level channel keys on every patch", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        appearance: "fixed",
        vectorscopePairX: 2,
        vectorscopePairY: 3,
        spectrumChannelType: "single",
        spectrumChannelCh: 2,
        channelLayout: "stereo",
      })
    );

    patchUiState({ referenceLufs: -23 });

    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({
      appearance: "fixed",
      referenceLufs: -23,
    });
  });

  it("does not let two disjoint patches clobber each other", () => {
    // The risk the old two-writer design only avoided implicitly.
    patchUiState({ appearance: "fixed", referenceLufs: -18 });
    patchUiState({ panelControls: { spectrumChannel: { type: "single", ch: 2 } } });

    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({
      appearance: "fixed",
      referenceLufs: -18,
      panelControls: { spectrumChannel: { type: "single", ch: 2 } },
    });
  });

  it("notifies subscribers on a storage event for the blob key", () => {
    const fn = vi.fn();
    const unsubscribe = subscribeUiState(fn);

    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    expect(fn).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("ignores storage events for unrelated keys", () => {
    const fn = vi.fn();
    subscribeUiState(fn);

    window.dispatchEvent(new StorageEvent("storage", { key: "some.other.key" }));
    expect(fn).not.toHaveBeenCalled();
  });
});
