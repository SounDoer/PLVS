import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

it.skipIf(process.platform !== "darwin")(
  "keeps macOS Dock geometry and visibility safe across Spaces",
  () => {
    const directory = mkdtempSync(join(tmpdir(), "plvs-dock-policy-"));
    try {
      const source = join(directory, "policy.m");
      const binary = join(directory, "policy");
      writeFileSync(
        source,
        `
#import "dock_window_policy.h"
#include <assert.h>
int main(void) {
  NSRect display = NSMakeRect(-1512, 200, 1512, 982);
  NSRect desktop = NSMakeRect(-1512, 270, 1512, 874);
  NSEdgeInsets safe = NSEdgeInsetsMake(38, 0, 0, 0);
  assert(NSEqualRects(plvs_dock_frame(desktop, display, safe, NO, YES, 150), NSMakeRect(-1512, 994, 1512, 150)));
  assert(NSEqualRects(plvs_dock_frame(desktop, display, safe, YES, YES, 150), NSMakeRect(-1512, 994, 1512, 150)));
  assert(NSEqualRects(plvs_dock_frame(desktop, display, safe, YES, NO, 150), NSMakeRect(-1512, 200, 1512, 150)));
  assert(NSEqualRects(plvs_dock_frame(desktop, display, safe, NO, NO, 150), NSMakeRect(-1512, 270, 1512, 150)));
  assert(plvs_dock_frame(desktop, display, safe, YES, YES, 2000).size.height == 944);
  assert(plvs_dock_frame(desktop, display, safe, NO, NO, 0).size.height == 1);
  for (int main = 0; main < 2; main++) {
    assert(!plvs_dock_may_show(YES, YES, YES, main, YES));
    assert(!plvs_dock_may_show(YES, NO, NO, main, YES));
    assert(plvs_dock_may_show(YES, YES, NO, main, YES));
  }
  assert(!plvs_dock_may_show(YES, YES, NO, NO, NO));
  assert(!plvs_dock_may_show(NO, YES, NO, NO, YES));
  assert(plvs_dock_may_show(NO, NO, YES, YES, YES));
  return 0;
}
`
      );
      const build = spawnSync(
        "clang",
        [
          "-x",
          "objective-c",
          "-Wall",
          "-Wextra",
          "-Werror",
          "-framework",
          "AppKit",
          "-I",
          resolve("src-tauri/native/macos"),
          source,
          "-o",
          binary,
        ],
        { encoding: "utf8" }
      );
      expect(build.stderr).toBe("");
      expect(build.status).toBe(0);
      expect(spawnSync(binary, [], { encoding: "utf8" }).status).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
);
