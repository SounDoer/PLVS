/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { markStarterItemsSeeded, starterItemsSeeded } from "./starterItemsSeed.js";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("starter items seeded marker", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockResolvedValue({ starterItemsSeeded: 1 });
  });

  afterEach(() => {
    delete window.__PLVS_INITIAL_STATE__;
  });

  it("records the marker once when both owners settle it together", async () => {
    window.__PLVS_INITIAL_STATE__ = { multiInstancePersistence: {} };
    expect(starterItemsSeeded()).toBe(false);

    await Promise.all([markStarterItemsSeeded(), markStarterItemsSeeded()]);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("persistence_save_global_preferences", {
      values: { starterItemsSeeded: true },
      expectedRevisions: { starterItemsSeeded: 0 },
    });
    expect(starterItemsSeeded()).toBe(true);
    expect(
      window.__PLVS_INITIAL_STATE__.multiInstancePersistence.globalPreferenceRevisions
    ).toEqual({ starterItemsSeeded: 1 });
  });

  it("writes nothing once the marker is set", async () => {
    window.__PLVS_INITIAL_STATE__ = {
      globalPreferences: { starterItemsSeeded: true },
      multiInstancePersistence: {},
    };
    await markStarterItemsSeeded();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("writes nothing on a backend without shared workspaces", async () => {
    await markStarterItemsSeeded();
    expect(invoke).not.toHaveBeenCalled();
    expect(starterItemsSeeded()).toBe(false);
  });

  it("can be retried after a failed write", async () => {
    window.__PLVS_INITIAL_STATE__ = { multiInstancePersistence: {} };
    vi.mocked(invoke).mockRejectedValueOnce(new Error("conflict"));
    await expect(markStarterItemsSeeded()).rejects.toThrow("conflict");

    await markStarterItemsSeeded();
    expect(starterItemsSeeded()).toBe(true);
  });
});
