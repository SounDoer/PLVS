import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_THEMES_V2 } from "../src/theme/builtinThemesV2.js";
import { buildPack } from "../src/transfer/packShape.js";
import { DEFAULT_WORKSPACE_STATE } from "../src/workspace/constants.js";
import {
  generateCommunityPreviews,
  prepareCommunityPreviewOutput,
} from "./generate-community-previews.mjs";

const roots = [];
const PROFILE = {
  id: "broadcast",
  name: "Broadcast",
  referenceLufs: -23,
  rules: [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }],
};

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "plvs-community-preview-command-"));
  roots.push(root);
  return root;
}

function artifact(root, type) {
  if (type === "loudness") {
    return writeArtifact(root, "profile.plvsloudness", buildPack("loudness", [PROFILE]));
  }
  if (type === "presets") {
    const preset = {
      id: "stereo-overview",
      name: "Stereo Overview",
      ...structuredClone(DEFAULT_WORKSPACE_STATE),
      dock: { enabled: false },
      loudnessProfileActive: "off",
    };
    return writeArtifact(root, "preset.plvspreset", buildPack("presets", [preset]));
  }
  const theme = {
    ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]),
    id: "custom-signal-amber",
    name: "Signal Amber",
  };
  return writeArtifact(root, "theme.plvstheme", buildPack("themes", [theme]));
}

function writeArtifact(root, name, pack) {
  const path = join(root, name);
  writeFileSync(path, `${JSON.stringify(pack, null, 2)}\n`);
  return path;
}

function imageRuntime() {
  return {
    async capture({ asset, path }) {
      await sharp({
        create: {
          width: asset.viewport.widthCssPx,
          height: asset.viewport.heightCssPx,
          channels: 4,
          background: { r: 18, g: 18, b: 18, alpha: 1 },
        },
      })
        .png()
        .toFile(path);
    },
    async close() {},
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Community preview command", () => {
  it.each([
    ["loudness", 2],
    ["presets", 1],
    ["themes", 10],
  ])("generates the exact sealed %s asset set", async (type, assetCount) => {
    const root = temporaryRoot();
    const source = artifact(root, type);
    const output = join(root, "rendered");

    const result = await generateCommunityPreviews({
      artifactPath: source,
      outputDirectory: output,
      createRuntime: async () => imageRuntime(),
    });

    expect(result.type).toBe(type);
    expect(result.report.assets).toHaveLength(assetCount);
    expect(result.report.assets.every(({ sha256 }) => /^sha256:[0-9a-f]{64}$/.test(sha256))).toBe(
      true
    );
    expect(JSON.parse(readFileSync(join(output, "preview-result.json"), "utf8"))).toEqual(
      result.report
    );
  });

  it("refuses an existing output directory before rendering", async () => {
    const root = temporaryRoot();
    const source = artifact(root, "loudness");
    const output = join(root, "rendered");
    mkdirSync(output);

    await expect(prepareCommunityPreviewOutput(source, output)).rejects.toThrow(
      "must not already exist"
    );
  });

  it("emits the same report for the same bytes and renderer output", async () => {
    const root = temporaryRoot();
    const source = artifact(root, "loudness");
    const first = await generateCommunityPreviews({
      artifactPath: source,
      outputDirectory: join(root, "first"),
      createRuntime: async () => imageRuntime(),
    });
    const second = await generateCommunityPreviews({
      artifactPath: source,
      outputDirectory: join(root, "second"),
      createRuntime: async () => imageRuntime(),
    });

    expect(second.report).toEqual(first.report);
  });

  it("removes its private staging directory when render settlement fails", async () => {
    const root = temporaryRoot();
    const source = artifact(root, "loudness");
    const output = join(root, "rendered");

    await expect(
      generateCommunityPreviews({
        artifactPath: source,
        outputDirectory: output,
        createRuntime: async () => ({
          capture: async () => {
            throw new Error("Preview did not settle.");
          },
          close: async () => {},
        }),
      })
    ).rejects.toThrow("did not settle");
    expect(existsSync(output)).toBe(false);
    expect(readFileSync(source, "utf8")).toContain('"loudness-pack"');
  });

  it("refuses malformed artifacts and missing output parents without leaving output", async () => {
    const root = temporaryRoot();
    const malformed = join(root, "bad.plvsloudness");
    writeFileSync(malformed, "{}\n");
    const output = join(root, "rendered");

    await expect(
      generateCommunityPreviews({
        artifactPath: malformed,
        outputDirectory: output,
        createRuntime: async () => imageRuntime(),
      })
    ).rejects.toThrow();
    expect(existsSync(output)).toBe(false);
    await expect(
      prepareCommunityPreviewOutput(malformed, join(root, "missing", "rendered"))
    ).rejects.toThrow("must already exist");
  });
});
