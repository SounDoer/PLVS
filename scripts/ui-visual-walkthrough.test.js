import { describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runUiVisualWalkthrough } from "./ui-visual-walkthrough.mjs";

describe("UI visual walkthrough runner", () => {
  it("establishes a private event fixture, inspects it publicly, and cancels the exact surface", async () => {
    let uiGeneration = 0;
    let surface = null;
    const calls = [];
    const invoke = vi.fn(async (args) => {
      calls.push(args);
      const command = args.join(" ");
      if (command.startsWith("capabilities")) {
        return {
          methods: [
            "app.capabilities",
            "app.inspect",
            "ui.inspect",
            "ui.cancel",
            "visual.screenshot",
          ],
        };
      }
      if (command.startsWith("inspect")) return { revision: 4 };
      if (command.startsWith("dev fixture establish")) {
        uiGeneration += 1;
        surface = {
          surfaceId: "ui-aaaaaaaaaaaaaaaa",
          kind: "closeConfirmation",
          origin: "event",
          supportedActions: ["cancel"],
          target: { phase: "decision" },
        };
        return {
          revision: 4,
          uiGeneration,
          fixtureId: "fixture-aaaaaaaaaaaaaaaa",
        };
      }
      if (command.startsWith("ui inspect")) {
        return {
          revision: 4,
          uiGeneration,
          activeBlockingEditors: surface ? ["close-confirmation"] : [],
          surfaces: surface ? [surface] : [],
        };
      }
      if (command.startsWith("visual screenshot")) {
        return { revision: 4, uiGeneration, artifact: { bytes: 8, sha256: "hash" } };
      }
      if (command.startsWith("ui cancel")) {
        surface = null;
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
            id: "close-confirmation",
            durable: [],
            ui: {
              kind: "eventFixture",
              name: "close-confirmation.requested",
              surfaceKind: "closeConfirmation",
              phase: "decision",
              action: "cancel",
            },
            screenshot: { target: "main", output: "close-confirmation.png" },
            touches: [],
          },
        ],
      },
      outDir: "C:/safe-output",
      invoke,
    });

    expect(calls.some((args) => args.slice(0, 3).join(" ") === "dev fixture establish")).toBe(true);
    expect(
      calls.filter((args) => args.slice(0, 2).join(" ") === "ui inspect").length
    ).toBeGreaterThan(1);
    expect(
      calls.some((args) => args.slice(0, 3).join(" ") === "ui cancel ui-aaaaaaaaaaaaaaaa")
    ).toBe(true);
    expect(result.scenarios[0]).toMatchObject({
      fixtureId: "fixture-aaaaaaaaaaaaaaaa",
      restored: true,
    });
  });

  it("leaves an established event fixture open when capture fails", async () => {
    const surface = {
      surfaceId: "ui-aaaaaaaaaaaaaaaa",
      kind: "closeConfirmation",
      origin: "event",
      supportedActions: ["cancel"],
      target: { phase: "decision" },
    };
    const calls = [];
    const invoke = vi.fn(async (args) => {
      calls.push(args);
      const command = args.join(" ");
      if (command.startsWith("capabilities")) {
        return {
          methods: [
            "app.capabilities",
            "app.inspect",
            "ui.inspect",
            "ui.cancel",
            "visual.screenshot",
          ],
        };
      }
      if (command.startsWith("inspect")) return { revision: 4 };
      if (command.startsWith("dev fixture establish")) {
        return {
          revision: 4,
          uiGeneration: 1,
          fixtureId: "fixture-aaaaaaaaaaaaaaaa",
        };
      }
      if (command.startsWith("ui inspect")) {
        const established = calls.some(
          (call) => call.slice(0, 3).join(" ") === "dev fixture establish"
        );
        return {
          revision: 4,
          uiGeneration: established ? 1 : 0,
          activeBlockingEditors: established ? ["close-confirmation"] : [],
          surfaces: established ? [surface] : [],
        };
      }
      if (command.startsWith("visual screenshot")) throw new Error("capture failed");
      throw new Error(`Unexpected command: ${command}`);
    });
    const manifest = {
      version: 1,
      workbench: { instanceId: "instance-a" },
      scenarios: [
        {
          id: "close-confirmation",
          durable: [],
          ui: {
            kind: "eventFixture",
            name: "close-confirmation.requested",
            surfaceKind: "closeConfirmation",
            phase: "decision",
            action: "cancel",
          },
          screenshot: { target: "main", output: "close-confirmation.png" },
          touches: [],
        },
      ],
    };

    /** @type {any} */
    let failure;
    try {
      await runUiVisualWalkthrough({ manifest, outDir: "C:/safe-output", invoke });
    } catch (error) {
      failure = error;
    }

    expect(failure?.report?.failure).toMatchObject({
      preservationRequired: true,
      fixtureId: "fixture-aaaaaaaaaaaaaaaa",
    });
    expect(calls.some((args) => args.slice(0, 2).join(" ") === "ui cancel")).toBe(false);
  });

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

  it("authors, captures, and discards a dirty editor through exact Agent Control surfaces", async () => {
    const editorSurfaceId = "ui-aaaaaaaaaaaaaaaa";
    const decisionSurfaceId = "ui-bbbbbbbbbbbbbbbb";
    let uiGeneration = 0;
    let draftGeneration = 0;
    let phase = "closed";
    const calls = [];
    const invoke = vi.fn(async (args) => {
      calls.push(args);
      const command = args.join(" ");
      if (command.startsWith("capabilities")) {
        return {
          methods: [
            "app.capabilities",
            "app.inspect",
            "ui.inspect",
            "ui.show.themeEditor",
            "ui.cancel",
            "editorDraft.inspect",
            "editorDraft.patch",
            "editorDraft.discard",
            "visual.screenshot",
          ],
        };
      }
      if (command.startsWith("inspect")) {
        return {
          revision: 4,
          appearance: { mode: "system", selectedThemeId: null },
          loudnessProfile: { activeId: "off" },
        };
      }
      if (command.startsWith("ui show theme-editor")) {
        phase = "editor";
        uiGeneration = 1;
        return {
          revision: 4,
          uiGeneration,
          surface: { surfaceId: editorSurfaceId, kind: "themeEditor", target: {} },
        };
      }
      if (command.startsWith("editor-draft inspect")) {
        return { revision: 4, uiGeneration, draftGeneration, dirty: false };
      }
      if (command.startsWith("editor-draft patch")) {
        draftGeneration = 1;
        uiGeneration = 2;
        return { revision: 4, uiGeneration, draftGeneration, changed: true, dirty: true };
      }
      if (command.startsWith("visual screenshot")) {
        return { revision: 4, uiGeneration, artifact: { bytes: 8, sha256: "hash" } };
      }
      if (command.startsWith("ui cancel")) {
        phase = "decision";
        uiGeneration = 3;
        return { revision: 4, uiGeneration };
      }
      if (command.startsWith("editor-draft discard")) {
        phase = "closed";
        uiGeneration = 4;
        return { revision: 4, uiGeneration, discarded: true };
      }
      if (command.startsWith("ui inspect")) {
        const editor = {
          surfaceId: editorSurfaceId,
          kind: "themeEditor",
          dirty: draftGeneration > 0,
          target: {},
        };
        const decision = {
          surfaceId: decisionSurfaceId,
          kind: "confirmation",
          origin: "nested",
          target: { purpose: "discardDraft", editorSurfaceId },
        };
        return {
          revision: 4,
          uiGeneration,
          topSurfaceId:
            phase === "decision" ? decisionSurfaceId : phase === "editor" ? editorSurfaceId : null,
          activeBlockingEditors: phase === "closed" ? [] : ["theme"],
          surfaces: phase === "closed" ? [] : phase === "decision" ? [editor, decision] : [editor],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const materialize = vi.fn(async () => "C:/private/theme-draft.json");

    const result = await runUiVisualWalkthrough({
      manifest: {
        version: 1,
        workbench: { instanceId: "instance-a" },
        scenarios: [
          {
            id: "theme-draft",
            durable: [],
            ui: { kind: "themeEditor", mode: "customize", themeId: "plvs-dark" },
            draft: { operations: [{ op: "setName", name: "Screenshot Draft" }] },
            screenshot: { target: "main", output: "theme-draft.png" },
            touches: [],
          },
        ],
      },
      outDir: "C:/safe-output",
      invoke,
      materialize,
    });

    expect(materialize).toHaveBeenCalledWith("theme-draft-draft", {
      operations: [{ op: "setName", name: "Screenshot Draft" }],
    });
    expect(calls.some((args) => args.slice(0, 2).join(" ") === "editor-draft patch")).toBe(true);
    expect(calls.some((args) => args.slice(0, 2).join(" ") === "editor-draft discard")).toBe(true);
    expect(result.restoration.verified).toBe(true);
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
