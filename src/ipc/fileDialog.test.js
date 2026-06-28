import { describe, expect, it } from "vitest";
import { MEDIA_EXTENSIONS } from "./fileDialog.js";

describe("MEDIA_EXTENSIONS", () => {
  it("includes QuickTime and common video containers", () => {
    for (const ext of ["mov", "wav", "mp4", "mkv", "webm", "avi", "ts", "m4a", "aac"]) {
      expect(MEDIA_EXTENSIONS).toContain(ext);
    }
  });
});
