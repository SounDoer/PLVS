import { describe, expect, it } from "vitest";
import { preventNativeContextMenu } from "./contextMenu.js";

describe("preventNativeContextMenu", () => {
  it("suppresses the native WebView context menu", () => {
    let prevented = false;
    preventNativeContextMenu({
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
  });
});
