import { describe, expect, it } from "vitest";
import {
  MAX_PACK_BYTES,
  MAX_PACK_DEPTH,
  MAX_PACK_ITEMS,
  collectPackResourceIssues,
  collectPackV2EnvelopeIssues,
  normalizePortableItemId,
  parsePackV2Items,
} from "./packV2.js";

function envelope(overrides = {}) {
  return {
    app: "PLVS",
    kind: "loudness-pack",
    version: 2,
    items: [{}],
    dependencies: [],
    ...overrides,
  };
}

describe("Pack V2 shared envelope", () => {
  it("accepts the canonical fields and optional app version", () => {
    expect(
      collectPackV2EnvelopeIssues(envelope({ createdWith: { appVersion: "0.17.0" } }))
    ).toEqual([]);
  });

  it("returns severity, paths, codes and structured limit details", () => {
    const issues = collectPackV2EnvelopeIssues(
      envelope({ items: Array.from({ length: MAX_PACK_ITEMS + 1 }, () => ({})) })
    );
    expect(issues).toContainEqual({
      severity: "error",
      code: "tooManyItems",
      path: "$.items",
      message: `items must contain at most ${MAX_PACK_ITEMS} entries.`,
      details: { count: MAX_PACK_ITEMS + 1, limit: MAX_PACK_ITEMS },
    });
  });

  it("rejects unknown fields, malformed diagnostics and forbidden dependencies", () => {
    const issues = collectPackV2EnvelopeIssues(
      envelope({
        extra: true,
        createdWith: { appVersion: "", host: "machine" },
        dependencies: [{ kind: "loudness-profile", items: [] }],
      })
    );
    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: "unknownField", path: "$.extra" },
      { code: "unknownField", path: "$.createdWith.host" },
      { code: "invalidAppVersion", path: "$.createdWith.appVersion" },
      { code: "unsupportedDependency", path: "$.dependencies" },
    ]);
  });

  it("bounds serialized size and nesting depth", () => {
    expect(
      collectPackResourceIssues({ value: "x".repeat(MAX_PACK_BYTES) }).map(({ code }) => code)
    ).toContain("packTooLarge");

    let nested = {};
    for (let index = 0; index < MAX_PACK_DEPTH; index += 1) nested = { child: nested };
    expect(collectPackResourceIssues(nested).map(({ code }) => code)).toContain("packTooDeep");
  });
});

describe("Pack V2 Item identities", () => {
  it("accepts bounded safe IDs and rejects reserved or unsafe IDs", () => {
    expect(normalizePortableItemId("profile.a-1_2")).toBe("profile.a-1_2");
    for (const value of ["", "-bad", "bad space", "__proto__", "prototype", "constructor"]) {
      expect(normalizePortableItemId(value)).toBeNull();
    }
  });

  it("aggregates duplicate IDs and converter issues", () => {
    const raw = envelope({ items: [{ id: "a", value: 1 }, { id: "a", value: 2 }, null] });
    const result = parsePackV2Items(raw, {
      entryLabel: "Test Item",
      invalidEntryCode: "invalidEntry",
      invalidIdCode: "invalidId",
      duplicateIdCode: "duplicateId",
      convert(document, id) {
        if (document.value === 1) {
          const error = new Error("invalid");
          error.issues = [{ code: "badValue", path: "$.value", message: "bad" }];
          throw error;
        }
        return { id, ...document };
      },
    });
    expect(result.items).toEqual([{ id: "a", value: 2 }]);
    expect(result.issues).toEqual([
      { severity: "error", code: "badValue", path: "$.items[0].value", message: "bad" },
      {
        severity: "error",
        code: "duplicateId",
        path: "$.items[1].id",
        message: "Duplicate id: a.",
      },
      {
        severity: "error",
        code: "invalidEntry",
        path: "$.items[2]",
        message: "A Test Item entry must be an object.",
      },
    ]);
  });
});
