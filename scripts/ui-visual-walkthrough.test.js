import { describe, expect, it, vi } from "vitest";
import { runUiVisualWalkthrough } from "./ui-visual-walkthrough.mjs";

describe("UI visual walkthrough runner", () => {
  it("uses only semantic CLI operations and closes the exact surface", async () => {
    let uiGeneration = 0;
    const calls = [];
    const invoke = vi.fn(async (args) => {
      calls.push(args);
      const command = args.join(" ");
      if (command.startsWith("capabilities"))
        return {
          methods: [
            "app.capabilities",
            "app.inspect",
            "ui.inspect",
            "ui.show.feedback",
            "ui.cancel",
            "visual.screenshot",
          ],
        };
      if (command.startsWith("inspect")) return { revision: 4 };
      if (command.startsWith("ui inspect"))
        return {
          revision: 4,
          uiGeneration,
          activeBlockingEditors: [],
          surfaces: [],
        };
      if (command.startsWith("ui show feedback")) {
        uiGeneration += 1;
        return {
          revision: 4,
          uiGeneration,
          surface: { surfaceId: "ui-aaaaaaaaaaaaaaaa", kind: "feedback", target: {} },
        };
      }
      if (command.startsWith("visual screenshot"))
        return { revision: 4, uiGeneration, artifact: { bytes: 8, sha256: "hash" } };
      if (command.startsWith("ui cancel")) {
        uiGeneration += 1;
        return { revision: 4, uiGeneration };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const result = await runUiVisualWalkthrough({
      manifest: {
        version: 1,
        workbench: { instanceId: "instance-a" },
        scenarios: [
          {
            id: "feedback",
            durable: [],
            ui: { kind: "feedback" },
            screenshot: { target: "main", output: "feedback.png" },
            touches: [],
          },
        ],
      },
      outDir: "C:/safe-output",
      invoke,
    });

    expect(calls.map((args) => args.slice(0, 3).join(" "))).toContain("ui show feedback");
    expect(
      calls.some(
        (args) => args[0] === "ui" && args[1] === "cancel" && args[2] === "ui-aaaaaaaaaaaaaaaa"
      )
    ).toBe(true);
    expect(JSON.stringify(calls)).not.toMatch(/playwright|cdp|selector|click/i);
    expect(result.restoration.verified).toBe(true);
    expect(result.artifacts).toEqual([
      expect.objectContaining({
        scenario: "feedback",
        path: expect.stringMatching(/feedback\.png$/),
      }),
    ]);
  });
});
