import { describe, expect, it } from "vitest";
import { settleEditorDraftObservation } from "./editorDraft.js";

describe("Editor Draft settlement", () => {
  it("allows the shared React settlement budget on a slower desktop renderer", async () => {
    const surfaceId = "ui-theme-editor";
    const startedAt = Date.now();
    const editorDraft = {
      inspect: () => ({ dirty: true, stale: false }),
    };
    const uiNavigation = {
      inspectUi: () => ({
        surfaces: [
          {
            surfaceId,
            dirty: Date.now() - startedAt >= 600,
            stale: false,
          },
        ],
      }),
    };

    await expect(
      settleEditorDraftObservation({ editorDraft, uiNavigation, kind: "theme", surfaceId })
    ).resolves.toMatchObject({ snapshot: { dirty: true } });
  });
});
