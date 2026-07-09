import { beforeEach, describe, expect, it, vi } from "vitest";

const { listen } = vi.hoisted(() => ({ listen: vi.fn() }));

vi.mock("@tauri-apps/api/event", () => ({ listen }));

import { onFileAnalysisCompleted, onFileAnalysisError, onFileAnalysisProgress } from "./events.js";

beforeEach(() => {
  listen.mockReset();
  listen.mockResolvedValue(vi.fn());
});

describe("file-analysis event seam", () => {
  it.each([
    ["file-analysis-progress", onFileAnalysisProgress],
    ["file-analysis-completed", onFileAnalysisCompleted],
    ["file-analysis-error", onFileAnalysisError],
  ])("subscribes to %s and unwraps its payload", async (eventName, subscribe) => {
    const handler = vi.fn();

    await subscribe(handler);

    expect(listen).toHaveBeenCalledWith(eventName, expect.any(Function));
    const listener = listen.mock.calls[0][1];
    listener({ payload: { path: "C:\\audio.wav" } });
    listener({ path: "C:\\raw.wav" });

    expect(handler).toHaveBeenNthCalledWith(1, { path: "C:\\audio.wav" });
    expect(handler).toHaveBeenNthCalledWith(2, { path: "C:\\raw.wav" });
  });
});
