import { describe, expect, it } from "vitest";
import {
  keyEventToAccelerator,
  normalizeAccelerator,
  reservedAcceleratorLabel,
  formatAcceleratorForDisplay,
  eventMatchesAccelerator,
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

describe("normalizeAccelerator", () => {
  it("requires a modifier and exactly one key", () => {
    expect(normalizeAccelerator("CmdOrCtrl+Alt+K")).toBe("CmdOrCtrl+Alt+K");
    expect(normalizeAccelerator("Shift+Alt+z")).toBe("Alt+Shift+Z");
    expect(normalizeAccelerator("Alt+Alt+Z")).toBeNull();
    expect(normalizeAccelerator("Alt+Control")).toBeNull();
    expect(normalizeAccelerator("K")).toBeNull();
    expect(normalizeAccelerator("CmdOrCtrl")).toBeNull();
  });
});

it("leaves the comma chord assignable and reserves native Quit on macOS", () => {
  expect(reservedAcceleratorLabel("CmdOrCtrl+,", true)).toBeNull();
  expect(reservedAcceleratorLabel("CmdOrCtrl+q", true)).toBe("Quit PLVS");
  expect(reservedAcceleratorLabel("CmdOrCtrl+Q", false)).toBeNull();
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

describe("eventMatchesAccelerator", () => {
  it("matches an event that produces the accelerator", () => {
    expect(eventMatchesAccelerator({ key: "k", ctrlKey: true }, "CmdOrCtrl+K")).toBe(true);
    expect(eventMatchesAccelerator({ key: "k", metaKey: true }, "CmdOrCtrl+K")).toBe(true);
  });
  it("matches a stored chord with legacy modifier order", () => {
    expect(
      eventMatchesAccelerator({ key: "g", ctrlKey: true, shiftKey: true }, "Shift+CmdOrCtrl+g")
    ).toBe(true);
  });
  it("does not match a different key or missing modifier", () => {
    expect(eventMatchesAccelerator({ key: "j", ctrlKey: true }, "CmdOrCtrl+K")).toBe(false);
    expect(eventMatchesAccelerator({ key: "k" }, "CmdOrCtrl+K")).toBe(false);
  });
});
