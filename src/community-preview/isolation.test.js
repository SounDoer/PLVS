import { describe, expect, it } from "vitest";
import { installCommunityPreviewIsolation } from "./isolation.js";

describe("Community preview isolation", () => {
  it("rejects every browser network surface before rendering", async () => {
    const host = {};
    installCommunityPreviewIsolation(host);

    await expect(host.fetch("https://example.com")).rejects.toThrow("Network access is disabled");
    expect(() => new host.XMLHttpRequest()).toThrow("Network access is disabled");
    expect(() => new host.WebSocket()).toThrow("Network access is disabled");
  });
});
