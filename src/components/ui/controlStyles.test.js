import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { badgeVariants } from "./badge.jsx";
import { buttonVariants } from "./button.jsx";
import { COMPACT_SWITCH_CLASS, COMPACT_SWITCH_THUMB_CLASS } from "./controlStyles.js";

describe("control visual semantics", () => {
  it("uses Input, Primary, and an opaque thumb for compact switches", () => {
    expect(COMPACT_SWITCH_CLASS).toContain("data-[state=unchecked]:bg-input");
    expect(COMPACT_SWITCH_CLASS).toContain("data-[state=checked]:bg-primary");
    expect(COMPACT_SWITCH_THUMB_CLASS).toContain("bg-background");
    expect(COMPACT_SWITCH_THUMB_CLASS).not.toMatch(/bg-[^ ]+\/[0-9]+/);
  });

  it("uses opaque derived hover fills for filled buttons", () => {
    expect(buttonVariants({ variant: "default" })).toContain("--ui-primary-hover");
    expect(buttonVariants({ variant: "secondary" })).toContain("--ui-secondary-hover");
    expect(buttonVariants({ variant: "destructive" })).toContain("--ui-destructive-hover");
  });

  it("keeps feedback badges flat on an opaque neutral surface", () => {
    for (const variant of ["success", "warning", "danger"]) {
      const classes = badgeVariants(
        /** @type {Parameters<typeof badgeVariants>[0]} */ ({ variant })
      );
      expect(classes).toContain("bg-secondary");
      expect(classes).toContain("border-border");
      expect(classes).not.toContain("transparent");
    }
  });

  it("keeps Live and Snapshot status chrome free of translucent washes and glow", () => {
    const transport = readFileSync(
      new URL("../SourceTransportCluster.jsx", import.meta.url),
      "utf8"
    );

    expect(transport).not.toMatch(/ui-activity-(?:live|snapshot)[^\n]*transparent/);
    expect(transport).not.toContain("shadow-[");
  });
});
