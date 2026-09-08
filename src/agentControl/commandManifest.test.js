import { describe, expect, it } from "vitest";
import {
  commandEntries,
  commandEntryById,
  commandManifest,
  runningAppCommandEntries,
  validateCommandManifest,
} from "./commandManifest.js";

function changed(mutator) {
  const manifest = structuredClone(commandManifest);
  mutator(manifest);
  return manifest;
}

describe("command manifest", () => {
  it("loads one immutable catalog without React or runtime state", () => {
    expect(commandManifest.manifestVersion).toBe(1);
    expect(commandEntries).toHaveLength(90);
    expect(runningAppCommandEntries).toHaveLength(89);
    expect(Object.isFrozen(commandManifest)).toBe(true);
    expect(Object.isFrozen(commandEntries[0].wireParams)).toBe(true);
  });

  it("describes representative public policies", () => {
    expect(commandEntryById.get("app.capabilities")).toMatchObject({
      path: ["capabilities"],
      execution: "runningApp",
      operation: "query",
      expectedRevision: "none",
    });
    expect(commandEntryById.get("panel.update")).toMatchObject({
      operation: "mutation",
      expectedRevision: "required",
      dryRun: true,
    });
    expect(commandEntryById.get("transport.file.analyze")).toMatchObject({
      operation: "action",
      dryRun: false,
    });
    expect(commandEntryById.get("measurement.wait")).toMatchObject({ operation: "wait" });
    expect(commandEntryById.get("preset.import").positionals[0].value.schemaRef).toBe(
      "preset.pack"
    );
    expect(commandEntryById.get("preset.export")).toMatchObject({ outputFile: "optional" });
    expect(commandEntryById.get("visual.screenshot")).toMatchObject({
      featureGate: "visual.screenshot",
      outputFile: "required",
    });
    expect(commandEntryById.get("doctor")).toMatchObject({
      execution: "offline",
      json: "optional",
      wireParams: { type: "object", additionalProperties: false },
    });
    expect(commandEntryById.has("schema.list")).toBe(false);
    expect(commandEntries.some(({ path }) => path.includes("--harness"))).toBe(false);
  });

  it.each([
    ["unknown root field", (m) => (m.typo = true), "$.typo"],
    ["unknown entry field", (m) => (m.commands[0].typo = true), ".typo"],
    ["unknown schema field", (m) => (m.commands[0].wireParams.typo = true), ".typo"],
    ["duplicate id", (m) => (m.commands[1].id = m.commands[0].id), "duplicate id"],
    [
      "duplicate path",
      (m) => {
        m.commands[1].path = m.commands[0].path;
        m.commands[1].family = m.commands[0].family;
      },
      "duplicate CLI path",
    ],
    [
      "duplicate wire method",
      (m) => (m.commands[1].wireMethod = m.commands[0].wireMethod),
      "duplicate wire method",
    ],
    ["empty summary", (m) => (m.commands[0].summary = " "), ".summary"],
    ["empty usage", (m) => (m.commands[0].usage = ""), ".usage"],
    ["unknown operation", (m) => (m.commands[0].operation = "read"), ".operation"],
    ["unknown policy", (m) => (m.commands[0].outputFile = "sometimes"), ".outputFile"],
    [
      "offline wire method",
      (m) => (m.commands.at(-1).wireMethod = "doctor.run"),
      "offline commands have no wire method",
    ],
    [
      "running app without wire method",
      (m) => delete m.commands[0].wireMethod,
      "require a wire method",
    ],
    ["family mismatch", (m) => (m.commands[0].family = "other"), ".family"],
    ["dry-run mismatch", (m) => (m.commands[0].dryRun = true), "dry-run option disagrees"],
    [
      "revision mismatch",
      (m) => (m.commands.find((entry) => entry.id === "panel.update").expectedRevision = "none"),
      "revision option disagrees",
    ],
    [
      "output mismatch",
      (m) => (m.commands.find((entry) => entry.id === "preset.export").outputFile = "none"),
      "output option disagrees",
    ],
  ])("rejects %s", (_name, mutate, message) => {
    expect(() => validateCommandManifest(changed(mutate))).toThrow(message);
  });
});
