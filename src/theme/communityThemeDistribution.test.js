import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES_V2 } from "./builtinThemesV2.js";
import { buildCommunityThemeDistribution } from "./communityThemeDistribution.js";
import { themeToPortable } from "./portableTheme.js";

function portable(name = "Studio / Broadcast") {
  return themeToPortable({
    ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]),
    id: "custom-distribution",
    name,
  });
}

describe("community Theme distribution", () => {
  it("uses identical canonical bytes for Copy and Download", async () => {
    const distribution = await buildCommunityThemeDistribution(portable());

    expect(distribution).toMatchObject({
      contentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      mediaType: "application/json",
      clipboard: { label: "Copy Theme" },
      download: {
        label: "Download .plvstheme",
        fileName: "Studio - Broadcast.plvstheme",
      },
    });
    expect(distribution.download.contents).toBe(distribution.clipboard.text);
    expect(JSON.parse(distribution.download.contents)).toEqual(portable());
  });

  it("falls back to a safe file name", async () => {
    const distribution = await buildCommunityThemeDistribution(portable("<>"));
    expect(distribution.download.fileName).toBe("--.plvstheme");
  });
});
