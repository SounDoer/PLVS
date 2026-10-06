import { describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("analyzes deterministic audio and restores the original transport", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "plvs-ui-walkthrough-"));
    let revision = 4;
    let analyzed = false;
    const calls = [];
    const invoke = vi.fn(async (args) => {
      calls.push(args);
      const command = args.join(" ");
      if (command.startsWith("capabilities")) {
        return {
          methods: [
            "app.capabilities",
            "app.inspect",
            "app.wait",
            "ui.inspect",
            "transport.inspect",
            "transport.source.live",
            "transport.source.file",
            "transport.live.start",
            "transport.file.analyze",
            "transport.file.select",
            "transport.file.remove",
            "visual.screenshot",
          ],
        };
      }
      if (command.startsWith("inspect")) return { revision };
      if (command.startsWith("ui inspect")) {
        return { revision, uiGeneration: 0, activeBlockingEditors: [], surfaces: [] };
      }
      if (command.startsWith("transport inspect")) {
        return {
          revision,
          source: "live",
          live: { state: "stopped" },
          files: {
            sessions: analyzed
              ? [{ id: "fixture-session", path: join(outDir, "fixture.wav"), state: "complete" }]
              : [],
          },
        };
      }
      if (command.startsWith("transport file analyze")) {
        analyzed = true;
        revision += 1;
        return { revision };
      }
      if (command.startsWith("transport file remove")) {
        analyzed = false;
        revision += 1;
        return { revision };
      }
      if (command.startsWith("transport source live")) return { revision };
      if (command.startsWith("visual screenshot")) {
        return { revision, uiGeneration: 0, artifact: { bytes: 8, sha256: "hash" } };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const result = await runUiVisualWalkthrough({
      manifest: {
        version: 1,
        workbench: { instanceId: "instance-a" },
        fixture: {
          audio: { id: "fixture", durationSeconds: 2, sampleRate: 8_000, channels: 2 },
        },
        scenarios: [
          {
            id: "file-analysis",
            durable: [],
            ui: { kind: "workspace" },
            screenshot: { target: "main", output: "file-analysis.png" },
            touches: [],
          },
        ],
      },
      outDir,
      invoke,
    });

    expect(result.fixture).toMatchObject({ id: "fixture", sessionId: "fixture-session" });
    expect(result.restoration.verified).toBe(true);
    expect(analyzed).toBe(false);
    expect(calls.some((args) => args.slice(0, 3).join(" ") === "transport file remove")).toBe(true);
  });
});
