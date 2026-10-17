import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import manifest from "../commandManifest.json" with { type: "json" };
import { SETTLEMENT_SLOTS } from "../bridge/settlement.js";
import { isDirectLane } from "../bridge/pipeline.js";
import { METHOD_TABLE } from "./index.js";

/// Served only while development fixtures are enabled, so the public manifest does not list them.
const DEVELOPMENT_FIXTURE_METHODS = ["dev.fixture.establish", "dev.fixture.reset"];
const DEVELOPMENT_PERFORMANCE_METHODS = ["dev.performance.inspect", "dev.performance.stall"];

describe("Agent Control handler coverage", () => {
  it("has exactly one handler for every wire method a running app serves", () => {
    const wireMethods = manifest.commands
      .filter(({ execution }) => execution === "runningApp")
      .map(({ wireMethod }) => wireMethod);
    const expected = [
      ...new Set([
        ...wireMethods,
        ...DEVELOPMENT_FIXTURE_METHODS,
        ...DEVELOPMENT_PERFORMANCE_METHODS,
      ]),
    ].sort();
    expect(Object.keys(METHOD_TABLE).sort()).toEqual(expected);
  });

  it("gives every handler a run function", () => {
    for (const [method, entry] of Object.entries(METHOD_TABLE)) {
      expect(typeof entry.run, method).toBe("function");
    }
  });

  it("answers long waits, measurement reads and visual capture outside the serialized queue", () => {
    const direct = Object.keys(METHOD_TABLE)
      .filter((method) => isDirectLane(METHOD_TABLE, method))
      .sort();
    const expected = Object.keys(METHOD_TABLE)
      .filter(
        (method) =>
          method === "app.wait" || method.startsWith("measurement.") || method.startsWith("visual.")
      )
      .sort();
    expect(direct).toEqual(expected);
    expect(isDirectLane(METHOD_TABLE, "no.such.method")).toBe(false);
  });

  it("reads the monitor inventory for the methods that place the Dock on a monitor", () => {
    const flagged = Object.entries(METHOD_TABLE)
      .filter(([, entry]) => entry.monitorInventory === true)
      .map(([method]) => method)
      .sort();
    expect(flagged).toEqual(["dock.describe", "dock.enter", "preset.apply"]);
  });

  it("arms only settlement slots the domain table defines", () => {
    const directory = fileURLToPath(new URL(".", import.meta.url));
    const armed = new Set();
    for (const file of readdirSync(directory).filter((name) => name.endsWith(".js"))) {
      const source = readFileSync(`${directory}/${file}`, "utf8");
      for (const [, name] of source.matchAll(/settlement\.arm\(\s*"([^"]+)"/g)) armed.add(name);
    }
    expect(armed.size).toBeGreaterThan(0);
    for (const name of armed) expect(SETTLEMENT_SLOTS, name).toContain(name);
  });
});
