import { describe, expect, it, vi } from "vitest";
import {
  COMMUNITY_BOOTSTRAP_COMMIT,
  publicationMarker,
  resolvePublishedCommunity,
} from "./community-publication.mjs";

const repository = "SounDoer/PLVS";
const commitSha = "a".repeat(40);
const options = { host: "plvs.soundoer.com", repository };
const json = (value) => new Response(JSON.stringify(value));

describe("Community publication identity", () => {
  it("reads the exact deployed commit without consulting a mutable release tag", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(publicationMarker(repository, commitSha)));
    await expect(resolvePublishedCommunity({ ...options, fetchImpl })).resolves.toEqual({
      schemaVersion: 1,
      repository,
      commitSha,
      bootstrap: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/community/publication.json?"),
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
        resolvePublishedCommunity({ ...options, fetchImpl: async () => json(marker) })
      ).rejects.toThrow();
    }
  );

  it("requires explicit first-publication bootstrap for a missing marker", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    await expect(resolvePublishedCommunity({ ...options, fetchImpl })).rejects.toThrow(
      "first empty-site"
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("bootstraps only the known legacy empty site to its immutable empty commit", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response("<h2>Nothing published yet</h2>"));
    await expect(
      resolvePublishedCommunity({ ...options, allowBootstrap: true, fetchImpl })
    ).resolves.toMatchObject({
      commitSha: COMMUNITY_BOOTSTRAP_COMMIT,
      bootstrap: true,
    });
  });

  it.each([
    "Unrelated page",
    "Nothing published yet <section data-catalogue-grid>",
    "Nothing published yet /community/files/item",
  ])("refuses nonempty or unrecognized markerless sites: %s", async (html) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response(html));
    await expect(
      resolvePublishedCommunity({ ...options, allowBootstrap: true, fetchImpl })
    ).rejects.toThrow("recover its exact baseline");
  });

  it.each([403, 500, 502])(
    "fails closed on HTTP %s even when bootstrap is requested",
    async (status) => {
      const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status }));
      await expect(
        resolvePublishedCommunity({ ...options, allowBootstrap: true, fetchImpl })
      ).rejects.toThrow(`HTTP ${status}`);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  );

  it("fails closed on network and malformed JSON responses", async () => {
    await expect(
      resolvePublishedCommunity({
        ...options,
        fetchImpl: async () => {
          throw new Error("offline");
        },
      })
    ).rejects.toThrow("offline");
    await expect(
      resolvePublishedCommunity({ ...options, fetchImpl: async () => new Response("not JSON") })
    ).rejects.toThrow();
  });

  it("never writes a branch or newline as publication identity", () => {
    expect(() => publicationMarker(repository, "main")).toThrow();
    expect(() => publicationMarker("SounDoer/PLVS\nother=value", commitSha)).toThrow();
  });
});
