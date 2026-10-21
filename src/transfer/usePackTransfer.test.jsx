/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";

// `isTauri` is a vi.fn created inside the factory (not a variable closed over from this file's
// top level) because `persistence/index.js` below calls it eagerly at import time, before any
// top-level `const` in this file has run -- closing over an outer variable here would throw a
// TDZ ReferenceError the moment that import resolves.
vi.mock("../ipc/env.js", () => ({ isTauri: vi.fn(() => true) }));

const readProfileFile = vi.fn();
const writeProfileFile = vi.fn();
vi.mock("../ipc/commands.js", () => ({
  readProfileFile: (...args) => readProfileFile(...args),
  writeProfileFile: (...args) => writeProfileFile(...args),
}));

const pickPackFile = vi.fn();
const pickSharedPackFile = vi.fn();
const savePackFile = vi.fn();
vi.mock("../ipc/fileDialog.js", () => ({
  pickPackFile: (...args) => pickPackFile(...args),
  pickSharedPackFile: (...args) => pickSharedPackFile(...args),
  savePackFile: (...args) => savePackFile(...args),
}));

import { isTauri } from "../ipc/env.js";
import { presetsStore, settingsStore, themesStore } from "../persistence/index.js";
import { STATUS_DISMISS_MS } from "../hooks/useTransientStatus.js";
import { usePackTransfer } from "./usePackTransfer.js";
import { buildPack } from "./packShape.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { serializePortableTheme, themeToPortable } from "../theme/portableTheme.js";

function clipboardTheme(name = "Sharesets Theme") {
  return serializePortableTheme(
    themeToPortable({
      ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]),
      id: "custom-sharesets",
      name,
    })
  );
}

function deferred() {
  /** @type {(value?: any) => void} */
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
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

  it("does not present Saved Items actions as busy while the save dialog is open", async () => {
    settingsStore.patch({
      loudnessProfiles: {
        active: "off",
        profiles: [{ id: "a", name: "A", referenceLufs: -23, rules: [] }],
      },
    });
    const saveDialog = deferred();
    savePackFile.mockReturnValue(saveDialog.promise);
    const { result } = renderHook(() => usePackTransfer());

    let operation;
    act(() => {
      operation = result.current.exportSelection("loudness", ["a"]);
    });
    expect(result.current.busy).toBe(false);

    await act(async () => {
      saveDialog.resolve(null);
      await operation;
    });
  });

  // The dismiss mechanism itself is covered in useTransientStatus.test.jsx; this pins that the
  // hook actually uses it, so a swap back to a plain useState does not go unnoticed.
  it("clears the status line on its own", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      settingsStore.patch({
        loudnessProfiles: {
          active: "off",
          profiles: [{ id: "a", name: "A", referenceLufs: -23, rules: [] }],
        },
      });
      savePackFile.mockResolvedValue("C:/out.plvsloudness");

      const { result } = renderHook(() => usePackTransfer());
      await act(async () => {
        await result.current.exportSelection("loudness", ["a"]);
      });
      expect(result.current.status).toBe("Loudness Profiles exported");

      await act(async () => {
        vi.advanceTimersByTime(STATUS_DISMISS_MS);
      });
      expect(result.current.status).toBe("");
    } finally {
      vi.useRealTimers();
    }
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

  it("bundles only the loudness profiles referenced by the exported presets", async () => {
    settingsStore.patch({
      loudnessProfiles: {
        active: "off",
        profiles: [
          { id: "a", name: "A", referenceLufs: -23, rules: [] },
          { id: "b", name: "B", referenceLufs: -16, rules: [] },
        ],
      },
    });
    presetsStore.patch({
      list: [
        {
          id: "p1",
          name: "Preset 1",
          ...structuredClone(DEFAULT_WORKSPACE_STATE),
          dock: { enabled: false },
          loudnessProfileActive: "profile:a",
        },
      ],
    });
    savePackFile.mockResolvedValue("C:/out.plvspreset");

    const { result } = renderHook(() => usePackTransfer());
    await act(async () => {
      await result.current.exportSelection("presets", ["p1"]);
    });

    const written = JSON.parse(writeProfileFile.mock.calls[0][1]);
    expect(written.items.map((item) => item.id)).toEqual(["p1"]);
    expect(written.dependencies).toHaveLength(1);
    expect(written.dependencies[0].kind).toBe("loudness-profile");
    expect(written.dependencies[0].items.map((profile) => profile.id)).toEqual(["a"]);
  });

  it("downloads a Blob instead of writing through Tauri outside the desktop app", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    const createObjectURL = vi.fn().mockReturnValue("blob:mock");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    let downloadedName;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      downloadedName = this.download;
    });

    settingsStore.patch({
      loudnessProfiles: {
        active: "off",
        profiles: [{ id: "a", name: "A", referenceLufs: -23, rules: [] }],
      },
    });

    const { result } = renderHook(() => usePackTransfer());
    await act(async () => {
      await result.current.exportSelection("loudness", ["a"]);
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
    expect(downloadedName).toBe("A.plvsloudness");
    expect(writeProfileFile).not.toHaveBeenCalled();

    clickSpy.mockRestore();
  });
});

// The caller decides whether to close its picker from this, so the three outcomes have to be
// distinguishable -- a cancelled save dialog is not a finished export.
describe("usePackTransfer export outcome", () => {
  beforeEach(() => {
    settingsStore.patch({
      loudnessProfiles: {
        active: "off",
        profiles: [{ id: "a", name: "A", referenceLufs: -23, rules: [] }],
      },
    });
  });

  it("reports a written file", async () => {
    savePackFile.mockResolvedValue("C:/out.plvsloudness");
    const { result } = renderHook(() => usePackTransfer());
    let outcome;
    await act(async () => {
      outcome = await result.current.exportSelection("loudness", ["a"]);
    });
    expect(outcome).toBe("written");
  });

  it("reports a dismissed save dialog", async () => {
    savePackFile.mockResolvedValue(null);
    const { result } = renderHook(() => usePackTransfer());
    let outcome;
    await act(async () => {
      outcome = await result.current.exportSelection("loudness", ["a"]);
    });
    expect(outcome).toBe("cancelled");
    expect(writeProfileFile).not.toHaveBeenCalled();
    expect(result.current.status).toBe("");
  });

  it("reports a failed write", async () => {
    savePackFile.mockResolvedValue("C:/out.plvsloudness");
    writeProfileFile.mockRejectedValue(new Error("disk full"));
    const { result } = renderHook(() => usePackTransfer());
    let outcome;
    await act(async () => {
      outcome = await result.current.exportSelection("loudness", ["a"]);
    });
    expect(outcome).toBe("failed");
    expect(result.current.status).toBe("Export failed");
  });
});

describe("usePackTransfer import", () => {
  it("becomes busy only after the shared-item dialog returns a file", async () => {
    const picker = deferred();
    const reader = deferred();
    pickSharedPackFile.mockReturnValue(picker.promise);
    readProfileFile.mockReturnValue(reader.promise);
    const { result } = renderHook(() => usePackTransfer());

    let operation;
    act(() => {
      operation = result.current.beginSharedImport();
    });
    expect(result.current.busy).toBe(false);

    await act(async () => {
      picker.resolve("C:/shared.plvstheme");
      await Promise.resolve();
    });
    expect(result.current.busy).toBe(true);

    await act(async () => {
      reader.resolve(clipboardTheme("Shared Theme"));
      await operation;
    });
    expect(result.current.busy).toBe(false);
  });

  it("dispatches a shared Item file by document kind", async () => {
    readProfileFile.mockResolvedValue(
      JSON.stringify({
        app: "PLVS",
        kind: "loudness-pack",
        version: 1,
        items: [{ id: "a", name: "A", referenceLufs: -23, rules: [] }],
      })
    );
    pickSharedPackFile.mockResolvedValue("C:/renamed-shared-item.plvstheme");

    const { result } = renderHook(() => usePackTransfer());
    await act(async () => {
      await result.current.beginSharedImport();
    });

    expect(result.current.review).toMatchObject({
      type: "loudness",
      origin: "file",
      itemPlan: [{ sourceId: "a", disposition: "added" }],
    });
  });

  it("opens file review for a directly downloaded portable Theme", async () => {
    readProfileFile.mockResolvedValue(clipboardTheme("Downloaded Theme"));
    pickPackFile.mockResolvedValue("C:/Downloaded Theme.plvstheme");

    const { result } = renderHook(() => usePackTransfer());
    await act(async () => {
      await result.current.beginImport("themes");
    });

    expect(result.current.review).toMatchObject({
      type: "themes",
      origin: "file",
      itemPlan: [{ name: "Downloaded Theme", disposition: "added" }],
    });
    expect(themesStore.read()).toEqual({});
  });

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
    expect(result.current.completion).toMatchObject({
      type: "loudness",
      itemPlan: [{ finalId: "a", name: "A" }],
    });
  });

  it("keeps an imported item when its explicit follow-up action is refused", async () => {
    readProfileFile.mockResolvedValue(
      JSON.stringify({
        app: "PLVS",
        kind: "loudness-pack",
        version: 1,
        items: [{ id: "a", name: "A", referenceLufs: -23, rules: [] }],
      })
    );
    pickPackFile.mockResolvedValue("C:/in.plvsloudness");
    const refused = vi.fn(() => false);

    const { result } = renderHook(() => usePackTransfer());
    await act(async () => result.current.beginImport("loudness"));
    act(() => result.current.confirmImport());
    await act(async () => result.current.runCompletionAction(refused));

    expect(refused).toHaveBeenCalledWith("loudness", "a");
    expect(settingsStore.read().loudnessProfiles.profiles.map((p) => p.id)).toEqual(["a"]);
    expect(result.current.completion.itemPlan[0].finalId).toBe("a");
    expect(result.current.status).toContain("was imported");
    expect(result.current.status).toContain("refused");
  });

  it("closes import completion after a successful explicit follow-up action", async () => {
    readProfileFile.mockResolvedValue(
      JSON.stringify({
        app: "PLVS",
        kind: "loudness-pack",
        version: 1,
        items: [{ id: "a", name: "A", referenceLufs: -23, rules: [] }],
      })
    );
    pickPackFile.mockResolvedValue("C:/in.plvsloudness");

    const { result } = renderHook(() => usePackTransfer());
    await act(async () => result.current.beginImport("loudness"));
    act(() => result.current.confirmImport());
    await act(async () => result.current.runCompletionAction(() => true));

    expect(result.current.completion).toBeNull();
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

describe("usePackTransfer paste", () => {
  it("opens the normal review before mutating the Theme library", async () => {
    const { result } = renderHook(() => usePackTransfer());

    await act(async () => {
      await result.current.beginPaste(clipboardTheme());
    });

    expect(result.current.review).toMatchObject({
      type: "themes",
      origin: "clipboard",
      itemPlan: [{ name: "Sharesets Theme", disposition: "added" }],
    });
    expect(themesStore.read()).toEqual({});

    act(() => result.current.confirmImport());
    expect(Object.values(themesStore.read().themes).map(({ name }) => name)).toEqual([
      "Sharesets Theme",
    ]);
    expect(result.current.status).toBe("Theme added to your library.");
  });

  it("reviews a pasted Loudness Profile pack before adding it", async () => {
    const { result } = renderHook(() => usePackTransfer());

    await act(async () => {
      await result.current.beginPaste(
        JSON.stringify(
          buildPack("loudness", [{ id: "spotify", name: "Spotify", referenceLufs: -14, rules: [] }])
        )
      );
    });

    expect(result.current.review).toMatchObject({
      type: "loudness",
      origin: "clipboard",
      itemPlan: [{ name: "Spotify", disposition: "added" }],
    });
    expect(settingsStore.read().loudnessProfiles?.profiles ?? []).toEqual([]);

    act(() => result.current.confirmImport());
    expect(settingsStore.read().loudnessProfiles.profiles.map(({ name }) => name)).toEqual([
      "Spotify",
    ]);
    expect(result.current.status).toBe("Loudness Profile added to your library.");
  });

  it("reviews a pasted Sharesets Preset before adding it", async () => {
    const { result } = renderHook(() => usePackTransfer());

    await act(async () => {
      await result.current.beginPaste(
        readFileSync("sharesets/catalogue/artifacts/dialogue-delivery-review-v1.plvspreset", "utf8")
      );
    });

    expect(result.current.review).toMatchObject({
      type: "presets",
      origin: "clipboard",
      itemPlan: [{ disposition: "added" }],
    });
    expect(presetsStore.read()).toEqual({});

    act(() => result.current.confirmImport());
    expect(result.current.status).toBe("Preset added to your library.");
  });

  it("reports unrelated clipboard text without opening review", async () => {
    const { result } = renderHook(() => usePackTransfer());

    await act(async () => {
      await result.current.beginPaste("ordinary clipboard text");
    });

    expect(result.current.review).toBeNull();
    expect(result.current.status).toBe(
      "Clipboard doesn't contain a PLVS Theme, Preset, or Loudness Profile."
    );
  });
});

describe("usePackTransfer development fixtures", () => {
  it("reviews the sample Preset and its bundled profile without writing, and resets only its own fixture", () => {
    const { result } = renderHook(() => usePackTransfer());

    act(() => result.current.developmentFixtures.review.establish("fixture-a"));
    expect(result.current.review).toMatchObject({
      type: "presets",
      origin: "clipboard",
      fixtureId: "fixture-a",
      itemPlan: [{ name: "Essential Monitoring", disposition: "added" }],
      profilePlan: [{ name: "Spotify", disposition: "added" }],
    });
    expect(result.current.developmentFixtures.review.matches("fixture-a")).toBe(true);

    act(() => result.current.developmentFixtures.review.reset("fixture-b"));
    expect(result.current.review).not.toBeNull();
    act(() => result.current.developmentFixtures.review.reset("fixture-a"));
    expect(result.current.review).toBeNull();
    expect(presetsStore.read()).toEqual({});
    expect(settingsStore.read().loudnessProfiles?.profiles ?? []).toEqual([]);
  });

  it("shows the completion without writing and refuses its follow-up action", async () => {
    const { result } = renderHook(() => usePackTransfer());
    const action = vi.fn(async () => true);

    act(() => result.current.developmentFixtures.completion.establish("fixture-a"));
    expect(result.current.completion).toMatchObject({
      type: "presets",
      fixtureId: "fixture-a",
      itemPlan: [{ name: "Essential Monitoring" }],
    });
    await act(async () => {
      expect(await result.current.runCompletionAction(action)).toBe(false);
    });
    expect(action).not.toHaveBeenCalled();
    expect(result.current.completion).not.toBeNull();
    expect(presetsStore.read()).toEqual({});

    act(() => result.current.developmentFixtures.completion.reset("fixture-a"));
    expect(result.current.completion).toBeNull();
  });
});
