import { describe, expect, it, vi } from "vitest";
import { publicationMarker, resolvePublishedSharesets } from "./sharesets-publication.mjs";

const repository = "SounDoer/PLVS";
const commitSha = "a".repeat(40);
const options = { host: "plvs.soundoer.com", repository };
const json = (value) => new Response(JSON.stringify(value));

describe("Sharesets publication identity", () => {
  it("reads the exact deployed commit without consulting a mutable release tag", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(publicationMarker(repository, commitSha)));
    await expect(resolvePublishedSharesets({ ...options, fetchImpl })).resolves.toEqual({
      schemaVersion: 1,
      repository,
      commitSha,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/sharesets/publication.json?"),
      expect.objectContaining({ redirect: "error" })
    );
  });

  it.each([
    { schemaVersion: 2, repository, commitSha },
    { schemaVersion: 1, repository: "other/repo", commitSha },
    { schemaVersion: 1, repository, commitSha: "main" },
    null,
  ])(
    "refuses an invalid marker instead of treating it as an empty Catalogue: %j",
    async (marker) => {
      await expect(
        resolvePublishedSharesets({ ...options, fetchImpl: async () => json(marker) })
      ).rejects.toThrow();
    }
  );

  it("refuses a missing marker instead of treating the Catalogue as empty", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    await expect(resolvePublishedSharesets({ ...options, fetchImpl })).rejects.toThrow(
      "recover its exact baseline"
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([403, 500, 502])("fails closed on HTTP %s", async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status }));
    await expect(resolvePublishedSharesets({ ...options, fetchImpl })).rejects.toThrow(
      `HTTP ${status}`
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed on network and malformed JSON responses", async () => {
    await expect(
      resolvePublishedSharesets({
        ...options,
        fetchImpl: async () => {
          throw new Error("offline");
        },
      })
    ).rejects.toThrow("offline");
    await expect(
      resolvePublishedSharesets({ ...options, fetchImpl: async () => new Response("not JSON") })
    ).rejects.toThrow();
  });

  it("never writes a branch or newline as publication identity", () => {
    expect(() => publicationMarker(repository, "main")).toThrow();
    expect(() => publicationMarker("SounDoer/PLVS\nother=value", commitSha)).toThrow();
  });
});
