import { afterEach, describe, expect, it, vi } from "vitest";
import { submitFeedback } from "./feedback.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("submitFeedback", () => {
  it("posts content and email as JSON and resolves true on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitFeedback({ content: "hello", email: "a@example.com" })).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith("https://list.plvs.soundoer.com/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello", email: "a@example.com" }),
    });
  });

  it("includes diagnostics only when the caller supplies them", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const diagnostics = {
      schemaVersion: 1,
      app: { version: "0.15.4", os: "windows", arch: "x86_64" },
      logs: ["last line"],
    };

    await submitFeedback({ content: "hello", diagnostics });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      content: "hello",
      diagnostics,
    });
  });

  it("resolves false on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(submitFeedback({ content: "hello" })).resolves.toBe(false);
  });

  it("resolves false when fetch rejects (offline/network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    await expect(submitFeedback({ content: "hello" })).resolves.toBe(false);
  });
});
