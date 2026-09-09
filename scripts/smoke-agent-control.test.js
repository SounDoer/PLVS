import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseJsonEnvelope, verifyArtifactBuffer } from "./smoke-agent-control.mjs";

describe("Agent Control smoke helpers", () => {
  it("accepts only successful JSON envelopes", () => {
    expect(parseJsonEnvelope("inspect", '{"ok":true,"result":{"revision":4}}')).toEqual({
      ok: true,
      result: { revision: 4 },
    });
    expect(() => parseJsonEnvelope("inspect", "not json")).toThrow("invalid JSON");
    expect(() =>
      parseJsonEnvelope(
        "inspect",
        '{"ok":false,"error":{"code":"appNotRunning","message":"Start PLVS."}}'
      )
    ).toThrow("appNotRunning");
  });

  it("verifies artifact type, size, and SHA-256", () => {
    const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
    const metadata = {
      bytes: png.length,
      sha256: createHash("sha256").update(png).digest("hex"),
    };
    expect(verifyArtifactBuffer("screenshot", png, metadata)).toEqual(metadata);
    expect(() => verifyArtifactBuffer("screenshot", Buffer.from("bad"), metadata)).toThrow();
  });
});
