import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { validateCommunityArtifactText } from "./communityArtifact.js";
import { buildPack } from "./packShape.js";

const PROFILE = {
  id: "broadcast",
  name: "Broadcast",
  referenceLufs: -23,
  rules: [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }],
};

function artifactText(type, items, options) {
  return `${JSON.stringify(buildPack(type, items, options), null, 2)}\n`;
}

describe("Community artifact validation", () => {
  it("returns the exact immutable byte identity and compatibility facts", async () => {
    const text = artifactText("loudness", [PROFILE]);
    const result = await validateCommunityArtifactText(text, {
      fileName: "broadcast.plvsloudness",
    });

    expect(result).toEqual({
      validatorVersion: 1,
      valid: true,
      type: "loudness",
      artifact: {
        fileName: "broadcast.plvsloudness",
        mediaType: "application/json",
        byteLength: new TextEncoder().encode(text).byteLength,
        sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        packKind: "loudness-pack",
        packVersion: 2,
      },
      primaryItem: {
        id: "broadcast",
        kind: "plvs-loudness-profile",
        name: "Broadcast",
        formatVersion: 1,
        semanticsVersion: 1,
      },
      compatibility: { metricIds: ["truePeak"] },
    });
  });

  it.each([
    [
      "presets",
      [
        {
          id: "mix",
          name: "Mix",
          ...structuredClone(DEFAULT_WORKSPACE_STATE),
          dock: { enabled: false },
          loudnessProfileActive: "off",
        },
      ],
      undefined,
      "mix.plvspreset",
    ],
    [
      "themes",
      [
        {
          ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]),
          id: "custom-community",
          name: "Community",
        },
      ],
      undefined,
      "community.plvstheme",
    ],
  ])(
    "validates a publishable %s artifact through the same boundary",
    async (type, items, options, fileName) => {
      await expect(
        validateCommunityArtifactText(artifactText(type, items, options), { fileName })
      ).resolves.toMatchObject({
        valid: true,
        type,
      });
    }
  );

  it("rejects non-canonical bytes even when the JSON content is valid", async () => {
    const compact = JSON.stringify(buildPack("loudness", [PROFILE]));
    await expect(
      validateCommunityArtifactText(compact, { fileName: "broadcast.plvsloudness" })
    ).rejects.toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: "nonCanonicalArtifactEncoding" })],
      })
    );
  });

  it("rejects an extension that disagrees with the validated Pack kind", async () => {
    await expect(
      validateCommunityArtifactText(artifactText("loudness", [PROFILE]), {
        fileName: "broadcast.plvstheme",
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: "invalidArtifactExtension" })],
      })
    );
  });

  it("rejects legacy and multi-item desktop Packs at publication intake", async () => {
    const legacy = `${JSON.stringify(
      { app: "PLVS", kind: "loudness-pack", version: 1, items: [PROFILE] },
      null,
      2
    )}\n`;
    await expect(
      validateCommunityArtifactText(legacy, { fileName: "broadcast.plvsloudness" })
    ).rejects.toThrow("Pack V2");
    await expect(
      validateCommunityArtifactText(
        artifactText("loudness", [PROFILE, { ...PROFILE, id: "other" }]),
        { fileName: "broadcast.plvsloudness" }
      )
    ).rejects.toThrow("exactly one primary Item");
  });
});
