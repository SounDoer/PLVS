/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
const savePackFile = vi.fn();
vi.mock("../ipc/fileDialog.js", () => ({
  pickPackFile: (...args) => pickPackFile(...args),
  savePackFile: (...args) => savePackFile(...args),
}));

const readClipboardText = vi.fn();
vi.mock("../ipc/clipboard.js", () => ({
  readClipboardText: (...args) => readClipboardText(...args),
}));

import { isTauri } from "../ipc/env.js";
import { presetsStore, settingsStore, themesStore } from "../persistence/index.js";
import { STATUS_DISMISS_MS } from "../hooks/useTransientStatus.js";
import { usePackTransfer } from "./usePackTransfer.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { serializePortableTheme, themeToPortable } from "../theme/portableTheme.js";

function clipboardTheme(name = "Community Theme") {
  return serializePortableTheme(
    themeToPortable({
      ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]),
      id: "custom-community",
      name,
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  isTauri.mockReturnValue(true);
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
    isTauri.mockReturnValue(false);
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

describe("usePackTransfer Theme paste", () => {
  it("opens the normal review before mutating the Theme library", async () => {
    const { result } = renderHook(() => usePackTransfer());

    await act(async () => {
      await result.current.beginThemePaste(clipboardTheme());
    });

    expect(result.current.review).toMatchObject({
      type: "themes",
      origin: "clipboard",
      itemPlan: [{ name: "Community Theme", disposition: "added" }],
    });
    expect(themesStore.read()).toEqual({});

    act(() => result.current.confirmImport());
    expect(Object.values(themesStore.read().themes).map(({ name }) => name)).toEqual([
      "Community Theme",
    ]);
    expect(result.current.status).toBe("Theme added to your library.");
  });

  it("reports non-Theme clipboard text without opening review", async () => {
    const { result } = renderHook(() => usePackTransfer());

    await act(async () => {
      await result.current.beginThemePaste("ordinary clipboard text");
    });

    expect(result.current.review).toBeNull();
    expect(result.current.status).toBe("Clipboard doesn't contain a PLVS Theme.");
  });

  it("uses the clipboard reader for the discoverable Paste button", async () => {
    readClipboardText.mockResolvedValue(clipboardTheme("Button Theme"));
    const { result } = renderHook(() => usePackTransfer());

    await act(async () => {
      await result.current.pasteThemeFromClipboard();
    });

    expect(readClipboardText).toHaveBeenCalledTimes(1);
    expect(result.current.review.itemPlan[0].name).toBe("Button Theme");
  });
});
