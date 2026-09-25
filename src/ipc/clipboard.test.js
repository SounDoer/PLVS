/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  readText: vi.fn(),
}));

vi.mock("./env.js", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ readText: mocks.readText }));

import { readClipboardText } from "./clipboard.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readClipboardText", () => {
  it("reads through the native plugin in the desktop app", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.readText.mockResolvedValue("native text");
    const webRead = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: webRead },
    });

    await expect(readClipboardText()).resolves.toBe("native text");
    expect(webRead).not.toHaveBeenCalled();
  });

  it("falls back to the web clipboard outside the desktop shell", async () => {
    mocks.isTauri.mockReturnValue(false);
    const webRead = vi.fn().mockResolvedValue("web text");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: webRead },
    });

    await expect(readClipboardText()).resolves.toBe("web text");
    expect(mocks.readText).not.toHaveBeenCalled();
  });
});
