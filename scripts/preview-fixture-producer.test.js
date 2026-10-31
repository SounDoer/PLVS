import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeOrCheckFixture } from "./preview-fixture-producer.mjs";

describe("preview fixture check/write boundary", () => {
  let directory;
  let path;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "plvs-fixture-check-"));
    path = join(directory, "fixture.json");
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });
  const check = (value, path) =>
    writeOrCheckFixture(value, path, { write: false, command: "npm run homepage:fixture" });

  it("accepts harmless formatting and bounded visual noise without rewriting the baseline", async () => {
    const text = '{"source":{"sha256":"same"},"visuals":{"bandCentersHz":[100]}}';
    await writeFile(path, text);
    await check({ visuals: { bandCentersHz: [100.0000000005] }, source: { sha256: "same" } }, path);
    expect(await readFile(path, "utf8")).toBe(text);
    expect(console.log.mock.calls.flat().join("\n")).toContain(
      "bounded floating-point differences"
    );
    expect(console.log.mock.calls.flat().join("\n")).toContain("/visuals/bandCentersHz/0");
  });

  it("reports the field and delta for a real regression and leaves the baseline intact", async () => {
    const text = '{"visuals":{"bandCentersHz":[100]}}';
    await writeFile(path, text);
    await expect(check({ visuals: { bandCentersHz: [100.01] } }, path)).rejects.toThrow(
      /\/visuals\/bandCentersHz\/0: numeric difference exceeds limit.*delta.*limit/
    );
    expect(await readFile(path, "utf8")).toBe(text);
  });

  it("reports missing or corrupt baselines instead of silently accepting them", async () => {
    await expect(check({}, path)).rejects.toThrow("is missing");
    await writeFile(path, "{broken");
    await expect(check({}, path)).rejects.toThrow("not valid JSON");
    expect(await readFile(path, "utf8")).toBe("{broken");
  });

  it("writes only when explicitly requested, preserving generated precision", async () => {
    const value = { visuals: { bandCentersHz: [100.0000000005] } };
    await writeOrCheckFixture(value, path, { write: true, command: "fixture" });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(value);
    await expect(
      writeOrCheckFixture({ value: NaN }, path, { write: true, command: "fixture" })
    ).rejects.toThrow("non-finite number");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(value);
  });
});
