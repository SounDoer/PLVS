import { describe, expect, it, vi } from "vitest";

import { createRevisionClock } from "../bridge/revisionClock.js";
import { developmentUpdateHandlers } from "./developmentUpdate.js";

describe("development update handlers", () => {
  it("acknowledges validated preferences before the persistence flush", async () => {
    /** @type {(value?: unknown) => void} */
    let finishSave = () => {};
    const setPreferences = vi.fn(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        })
    );
    /** @type {any} */
    const context = {
      requestId: "request-1",
      request: {
        method: "dev.update.preferences",
        params: {
          expectedRevision: 0,
          expectedUiGeneration: 11,
          surfaceId: "update-preferences",
          autoCheck: true,
          autoDownload: true,
        },
      },
      clock: createRevisionClock({ onWake: () => {} }),
      snap: {
        developmentUpdate: { enabled: true, setPreferences },
        uiNavigation: {
          inspectUi: () => ({
            uiGeneration: 11,
            surfaces: [
              {
                surfaceId: "update-preferences",
                kind: "update",
                target: { phase: "preferences" },
              },
            ],
          }),
        },
      },
    };
    const response = await developmentUpdateHandlers["dev.update.preferences"].run(context);

    expect(response).toMatchObject({
      requestId: "request-1",
      result: { action: "dev.update.preferences", accepted: true, revision: 0 },
    });
    expect(setPreferences).not.toHaveBeenCalled();
    expect(response.afterResponse).toBeTypeOf("function");
    const saving = response.afterResponse?.();
    expect(setPreferences).toHaveBeenCalledWith({ autoCheck: true, autoDownload: true });
    finishSave();
    await saving;
  });
});
