import { describe, expect, it, vi } from "vitest";
import {
  createSettingsDispatcher,
  optimisticSettingsValue,
  settingsActionArguments,
  settingsViewSnapshot,
} from "./settingsTransport.js";

describe("Settings presentation transport", () => {
  it("strips DOM events from button actions and retains explicit value arguments", () => {
    /** @type {any} */
    const event = { currentTarget: {} };
    event.currentTarget.event = event;
    expect(settingsActionArguments("onSave", [event])).toEqual([]);
    expect(settingsActionArguments("onExportConfiguration", [event])).toEqual([]);
    expect(settingsActionArguments("onPaletteColor", ["status", "safe", "#123456", event])).toEqual(
      ["status", "safe", "#123456"]
    );
    expect(settingsActionArguments("onName", ["A Theme"])).toEqual(["A Theme"]);
  });
  it("exposes only declared callbacks and serializable view data", () => {
    const snapshot = settingsViewSnapshot("theme", {
      draft: { name: "A" },
      onName: vi.fn(),
      internalShortcut: vi.fn(),
    });
    expect(snapshot).toEqual({ values: { draft: { name: "A" } }, actions: ["onName"] });
  });
  it("orders a draft change before Save even when both arrive before a render", async () => {
    const document = { name: "Before" };
    const saved = [];
    const current = {
      active: true,
      session: "draft-a",
      view: "theme",
      model: {
        onName: (name) => {
          document.name = name;
        },
        onSave: () => {
          saved.push(document.name);
        },
      },
    };
    const dispatch = createSettingsDispatcher({
      read: () => current,
      commit: (callback) => callback(),
    });
    await Promise.all([
      dispatch({ session: "draft-a", sequence: 1, name: "onName", args: ["After"] }),
      dispatch({ session: "draft-a", sequence: 2, name: "onSave", args: [] }),
    ]);
    expect(saved).toEqual(["After"]);
  });
  it("rejects duplicate, stale, and undeclared actions before mutating anything", async () => {
    const onSave = vi.fn();
    const state = {
      enabled: true,
      active: true,
      session: "draft-b",
      view: "theme",
      model: { onSave },
    };
    const dispatch = createSettingsDispatcher({
      read: () => state,
      commit: (callback) => callback(),
    });
    const request = { session: "draft-b", sequence: 1, name: "onSave", args: [] };
    await expect(dispatch({ ...request, session: "draft-a" })).rejects.toThrow(/session changed/);
    await expect(dispatch({ ...request, name: "patchStore" })).rejects.toThrow(/Unsupported/);
    expect(onSave).not.toHaveBeenCalled();
    state.enabled = false;
    await expect(dispatch(request)).rejects.toThrow(/session changed/);
    expect(onSave).not.toHaveBeenCalled();
    state.enabled = true;
    await dispatch(request);
    await expect(dispatch(request)).rejects.toThrow(/already handled/);
    expect(onSave).toHaveBeenCalledOnce();
    state.active = false;
    await expect(dispatch({ ...request, sequence: 2 })).rejects.toThrow(/session changed/);
    expect(onSave).toHaveBeenCalledOnce();
  });
  it("keeps typed values ahead of an older acknowledged snapshot", () => {
    let value = { content: "" };
    value = optimisticSettingsValue("feedback", value, "setContent", ["A"]);
    value = optimisticSettingsValue("feedback", value, "setContent", ["AB"]);
    expect(value.content).toBe("AB");
  });
});

it("preserves an explicit blank Profile threshold through JSON serialization", async () => {
  const onUpdateRule = vi.fn();
  const dispatch = createSettingsDispatcher({
    read: () => ({ active: true, session: "profile", view: "profile", model: { onUpdateRule } }),
    commit: (callback) => callback(),
  });
  const args = JSON.parse(
    JSON.stringify(settingsActionArguments("onUpdateRule", [0, { value: undefined }]))
  );
  await dispatch({ session: "profile", sequence: 1, name: "onUpdateRule", args });
  expect(onUpdateRule).toHaveBeenCalledWith(0, { value: undefined });
});
