/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));

const readProfileFile = vi.fn();
const writeProfileFile = vi.fn();
vi.mock("../ipc/commands.js", () => ({
  readProfileFile: (...args) => readProfileFile(...args),
  writeProfileFile: (...args) => writeProfileFile(...args),
}));

const pickPackFile = vi.fn();
const savePackFile = vi.fn();
vi.mock("../ipc/fileDialog.js", () => ({
  pickPackFile: (...args) => pickPackFile(...args),
  savePackFile: (...args) => savePackFile(...args),
}));

import { presetsStore, settingsStore, themesStore } from "../persistence/index.js";
import { usePackTransfer } from "./usePackTransfer.js";

beforeEach(() => {
  vi.clearAllMocks();
  settingsStore.reset();
  presetsStore.reset();
  themesStore.reset();
});

describe("usePackTransfer export", () => {
  it("writes a pack containing only the selected items", async () => {
    settingsStore.patch({
      loudnessProfiles: {
        active: "off",
        profiles: [
          { id: "a", name: "A", referenceLufs: -23, rules: [] },
          { id: "b", name: "B", referenceLufs: -16, rules: [] },
        ],
      },
    });
    savePackFile.mockResolvedValue("C:/out.plvsloudness");

    const { result } = renderHook(() => usePackTransfer());
    await act(async () => {
      await result.current.exportSelection("loudness", ["a"]);
    });

    const written = JSON.parse(writeProfileFile.mock.calls[0][1]);
    expect(written.kind).toBe("loudness-pack");
    expect(written.items.map((item) => item.id)).toEqual(["a"]);
  });

  it("names the file after the item when exactly one is selected", async () => {
    settingsStore.patch({
      loudnessProfiles: {
        active: "off",
        profiles: [{ id: "a", name: "A", referenceLufs: -23, rules: [] }],
      },
    });
    savePackFile.mockResolvedValue(null);

    const { result } = renderHook(() => usePackTransfer());
    await act(async () => {
      await result.current.exportSelection("loudness", ["a"]);
    });

    expect(savePackFile.mock.calls[0][1]).toBe("A.plvsloudness");
  });
});

describe("usePackTransfer import", () => {
  it("opens a review with the plan and writes nothing yet", async () => {
    readProfileFile.mockResolvedValue(
      JSON.stringify({
        app: "PLVS",
        kind: "loudness-pack",
        version: 1,
        exportedAt: "x",
        items: [{ id: "a", name: "A", referenceLufs: -23, rules: [] }],
      })
    );
    pickPackFile.mockResolvedValue("C:/in.plvsloudness");

    const { result } = renderHook(() => usePackTransfer());
    await act(async () => {
      await result.current.beginImport("loudness");
    });

    expect(result.current.review.itemPlan[0].disposition).toBe("added");
    expect(settingsStore.read().loudnessProfiles).toBeUndefined();
  });

  it("appends on confirm", async () => {
    readProfileFile.mockResolvedValue(
      JSON.stringify({
        app: "PLVS",
        kind: "loudness-pack",
        version: 1,
        exportedAt: "x",
        items: [{ id: "a", name: "A", referenceLufs: -23, rules: [] }],
      })
    );
    pickPackFile.mockResolvedValue("C:/in.plvsloudness");

    const { result } = renderHook(() => usePackTransfer());
    await act(async () => {
      await result.current.beginImport("loudness");
    });
    act(() => {
      result.current.confirmImport();
    });

    expect(settingsStore.read().loudnessProfiles.profiles.map((p) => p.id)).toEqual(["a"]);
  });

  it("reports the specific reason for a wrong-kind file", async () => {
    readProfileFile.mockResolvedValue(
      JSON.stringify({ app: "PLVS", kind: "theme-pack", version: 1, exportedAt: "x", items: [] })
    );
    pickPackFile.mockResolvedValue("C:/in.plvsloudness");

    const { result } = renderHook(() => usePackTransfer());
    await act(async () => {
      await result.current.beginImport("loudness");
    });

    expect(result.current.status).toBe("This is a Theme file. Import it from the Theme row.");
    expect(result.current.review).toBe(null);
  });

  it("reports unreadable JSON", async () => {
    readProfileFile.mockResolvedValue("{ not json");
    pickPackFile.mockResolvedValue("C:/in.plvsloudness");

    const { result } = renderHook(() => usePackTransfer());
    await act(async () => {
      await result.current.beginImport("loudness");
    });

    expect(result.current.status).toBe("This file could not be read.");
  });
});
