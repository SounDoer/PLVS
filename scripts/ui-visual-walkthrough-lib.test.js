import { describe, expect, it } from "vitest";
import {
  assertWalkthroughStart,
  buildRestorationLedger,
  validateWalkthroughManifest,
} from "./ui-visual-walkthrough-lib.mjs";

const manifest = {
  version: 1,
  workbench: { instanceId: "instance-a" },
  scenarios: [
    {
      id: "appearance",
      durable: [{ family: "view", patch: { surfaceOpacity: 100 } }],
      ui: { kind: "settings", section: "appearance" },
      screenshot: { target: "main", output: "appearance.png" },
      touches: ["view.surfaceOpacity"],
    },
    {
      id: "feedback",
      durable: [],
      ui: { kind: "feedback" },
      screenshot: { target: "main", output: "feedback.png" },
      touches: [],
    },
  ],
};

describe("UI visual walkthrough manifest", () => {
  it("accepts bounded semantic scenarios and builds reverse restoration", () => {
    expect(validateWalkthroughManifest(manifest)).toEqual([]);
    expect(
      buildRestorationLedger(manifest, {
        view: { surfaceOpacity: 72, pinned: false },
      })
    ).toEqual([
      {
        family: "view",
        patch: { surfaceOpacity: 72 },
        verify: { surfaceOpacity: 72 },
      },
    ]);
  });

  it.each([
    [{ ...manifest, workbench: {} }, "instanceId"],
    [
      {
        ...manifest,
        scenarios: [{ ...manifest.scenarios[0], click: "Save" }],
      },
      "unknown field",
    ],
    [
      {
        ...manifest,
        scenarios: [
          { ...manifest.scenarios[0], screenshot: { target: "main", output: "../escape.png" } },
        ],
      },
      "relative",
    ],
    [
      {
        ...manifest,
        scenarios: [{ ...manifest.scenarios[0], touches: ["view.pinned"] }],
      },
      "touches",
    ],
    [
      {
        ...manifest,
        scenarios: [{ ...manifest.scenarios[0], ui: { kind: "confirm", action: "save" } }],
      },
      "UI target",
    ],
  ])("rejects executable, escaping, undeclared, or confirmation-shaped input", (value, message) => {
    expect(validateWalkthroughManifest(value).join("\n")).toMatch(message);
  });

  it("refuses unrelated drafts and real decision surfaces before mutation", () => {
    const capabilities = {
      methods: [
        "app.capabilities",
        "app.inspect",
        "ui.inspect",
        "ui.show.settings",
        "ui.show.feedback",
        "ui.close",
        "ui.cancel",
        "visual.screenshot",
        "view.inspect",
        "view.update",
      ],
    };
    expect(() =>
      assertWalkthroughStart(manifest, capabilities, {
        activeBlockingEditors: ["feedback"],
        surfaces: [],
      })
    ).toThrow(/blocking editor/i);
    expect(() =>
      assertWalkthroughStart(manifest, capabilities, {
        activeBlockingEditors: [],
        surfaces: [{ origin: "event", kind: "update" }],
      })
    ).toThrow(/event decision/i);
  });
});
