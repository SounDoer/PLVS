import { describe, expect, it } from "vitest";
import {
  requireSuccessfulCI,
  resolveWebsiteBaseline,
  validateWebsiteMarker,
} from "./website-publication.mjs";

const sha = "a".repeat(40);
const marker = {
  schemaVersion: 1,
  repository: "SounDoer/PLVS",
  websiteSha: sha,
  contentSha: "b".repeat(40),
};
describe("website publication identity and gate", () => {
  it("allows evidence-based bootstrap only for a missing marker, never to override live or broken state", async () => {
    const live = { status: 200, json: async () => marker };
    await expect(resolveWebsiteBaseline(live, marker.repository)).resolves.toBe(sha);
    await expect(resolveWebsiteBaseline({ status: 404 }, marker.repository, sha)).resolves.toBe(
      sha
    );
    await expect(resolveWebsiteBaseline({ status: 404 }, marker.repository)).rejects.toThrow();
    await expect(
      resolveWebsiteBaseline({ status: 404 }, marker.repository, "main")
    ).rejects.toThrow();
    await expect(resolveWebsiteBaseline(live, marker.repository, sha)).rejects.toThrow();
    await expect(resolveWebsiteBaseline({ status: 500 }, marker.repository, sha)).rejects.toThrow();
    await expect(
      resolveWebsiteBaseline({ status: 200, json: async () => ({}) }, marker.repository)
    ).rejects.toThrow();
  });
  it("keeps website and catalogue identities distinct and rejects malformed or foreign markers", () => {
    expect(validateWebsiteMarker(marker, marker.repository)).toEqual(marker);
    for (const invalid of [
      { ...marker, schemaVersion: 2 },
      { ...marker, repository: "other/repo" },
      { ...marker, websiteSha: "main" },
      { ...marker, contentSha: null },
    ]) {
      expect(() => validateWebsiteMarker(invalid, marker.repository)).toThrow();
    }
  });
  it("requires successful completed push CI for exactly the deployed SHA", () => {
    const run = { head_sha: sha, event: "push", status: "completed", conclusion: "success" };
    expect(requireSuccessfulCI([run], sha)).toBe(run);
    for (const invalid of [
      { ...run, head_sha: "b".repeat(40) },
      { ...run, event: "pull_request" },
      { ...run, status: "in_progress" },
      { ...run, conclusion: "failure" },
      { ...run, conclusion: "cancelled" },
    ]) {
      expect(() => requireSuccessfulCI([invalid], sha)).toThrow();
    }
    expect(() => requireSuccessfulCI([], sha)).toThrow();
  });
});
