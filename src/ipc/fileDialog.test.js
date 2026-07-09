import { describe, expect, it, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { MEDIA_EXTENSIONS, pickMediaFile } from "./fileDialog.js";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

describe("MEDIA_EXTENSIONS", () => {
  it("includes QuickTime and common video containers", () => {
    for (const ext of ["mov", "wav", "mp4", "mkv", "webm", "avi", "ts", "m4a", "aac"]) {
      expect(MEDIA_EXTENSIONS).toContain(ext);
    }
  });
});

describe("pickMediaFile", () => {
  it("opens the dialog plugin with the media filter and returns the selected path", async () => {
    open.mockResolvedValue("C:\\mix.wav");

    await expect(pickMediaFile()).resolves.toBe("C:\\mix.wav");

    expect(open).toHaveBeenCalledWith({
      multiple: false,
      directory: false,
      filters: [{ name: "Media", extensions: MEDIA_EXTENSIONS }],
    });
  });

  it("normalizes cancelled or multi-select results to null", async () => {
    open.mockResolvedValue(["C:\\mix.wav"]);
    await expect(pickMediaFile()).resolves.toBeNull();

    open.mockResolvedValue(null);
    await expect(pickMediaFile()).resolves.toBeNull();
  });
});
