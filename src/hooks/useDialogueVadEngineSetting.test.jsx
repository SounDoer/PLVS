/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDialogueVadEngineSetting } from "./useDialogueVadEngineSetting.js";
import { settingsStore } from "../persistence/index.js";

beforeEach(() => {
  settingsStore.reset();
});

describe("useDialogueVadEngineSetting", () => {
  it("falls back to the default engine when nothing is stored", () => {
    const { result } = renderHook(() => useDialogueVadEngineSetting());
    expect(result.current.dialogueVadEngine).toBe("firered");
  });

  it("reads a stored engine", () => {
    settingsStore.patch({ dialogueVadEngine: "ten" });
    const { result } = renderHook(() => useDialogueVadEngineSetting());
    expect(result.current.dialogueVadEngine).toBe("ten");
  });

  it("repairs an unknown stored engine", () => {
    settingsStore.patch({ dialogueVadEngine: "nonsense" });
    const { result } = renderHook(() => useDialogueVadEngineSetting());
    expect(result.current.dialogueVadEngine).toBe("firered");
  });

  it("persists a new engine and updates state", () => {
    const { result } = renderHook(() => useDialogueVadEngineSetting());
    act(() => {
      result.current.setDialogueVadEngine("silero");
    });
    expect(result.current.dialogueVadEngine).toBe("silero");
    expect(settingsStore.read().dialogueVadEngine).toBe("silero");
  });

  it("ignores an unknown engine on write", () => {
    const { result } = renderHook(() => useDialogueVadEngineSetting());
    act(() => {
      result.current.setDialogueVadEngine("nonsense");
    });
    expect(result.current.dialogueVadEngine).toBe("firered");
  });
});
