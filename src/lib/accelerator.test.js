import { describe, expect, it } from "vitest";
import {
  keyEventToAccelerator,
  isValidAccelerator,
  formatAcceleratorForDisplay,
} from "./accelerator.js";

describe("keyEventToAccelerator", () => {
  it("builds CmdOrCtrl from ctrl/meta plus letter", () => {
    expect(keyEventToAccelerator({ key: "k", ctrlKey: true })).toBe("CmdOrCtrl+K");
    expect(keyEventToAccelerator({ key: "k", metaKey: true })).toBe("CmdOrCtrl+K");
  });
  it("orders modifiers CmdOrCtrl, Alt, Shift", () => {
    expect(keyEventToAccelerator({ key: "z", ctrlKey: true, altKey: true, shiftKey: true })).toBe(
      "CmdOrCtrl+Alt+Shift+Z"
    );
  });
  it("returns null without a modifier", () => {
    expect(keyEventToAccelerator({ key: "k" })).toBeNull();
  });
  it("returns null for a bare modifier key", () => {
    expect(keyEventToAccelerator({ key: "Control", ctrlKey: true })).toBeNull();
  });
  it("maps space to Space", () => {
    expect(keyEventToAccelerator({ key: " ", ctrlKey: true })).toBe("CmdOrCtrl+Space");
  });
});

describe("isValidAccelerator", () => {
  it("requires a modifier and exactly one key", () => {
    expect(isValidAccelerator("CmdOrCtrl+Alt+K")).toBe(true);
    expect(isValidAccelerator("Alt+Shift+Z")).toBe(true);
    expect(isValidAccelerator("K")).toBe(false);
    expect(isValidAccelerator("CmdOrCtrl")).toBe(false);
    expect(isValidAccelerator("")).toBe(false);
  });
});

describe("formatAcceleratorForDisplay", () => {
  it("uses glyphs on mac, words on windows", () => {
    expect(formatAcceleratorForDisplay("CmdOrCtrl+Alt+K", { isMac: true })).toBe("⌘⌥K");
    expect(formatAcceleratorForDisplay("CmdOrCtrl+Alt+K", { isMac: false })).toBe("Ctrl+Alt+K");
  });
  it("maps Escape to Esc and passes unknown tokens through", () => {
    expect(formatAcceleratorForDisplay("Escape", { isMac: false })).toBe("Esc");
    expect(formatAcceleratorForDisplay("Space", { isMac: true })).toBe("Space");
    expect(formatAcceleratorForDisplay("CmdOrCtrl+,", { isMac: false })).toBe("Ctrl+,");
  });
});
