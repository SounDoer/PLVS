import { describe, expect, it } from "vitest";
import { sliceChangelogSince } from "./changelogAggregate.js";

const NOTES = [
  "## [0.11.2] - 2026-07-24",
  "",
  "### Fixed",
  "- Latest fix.",
  "",
  "## [0.11.1] - 2026-07-24",
  "",
  "### Changed",
  "- Middle change.",
  "",
  "## [0.11.0] - 2026-07-23",
  "",
  "### Added",
  "- Older feature.",
].join("\n");

describe("sliceChangelogSince", () => {
  it("keeps every section newer than the installed version", () => {
    const result = sliceChangelogSince(NOTES, "0.11.0");
    expect(result).toContain("## [0.11.2]");
    expect(result).toContain("- Latest fix.");
    expect(result).toContain("## [0.11.1]");
    expect(result).toContain("- Middle change.");
    // The installed version's own section is excluded.
    expect(result).not.toContain("## [0.11.0]");
    expect(result).not.toContain("- Older feature.");
  });

  it("spans several minor versions", () => {
    const result = sliceChangelogSince(NOTES, "0.9.0");
    expect(result).toContain("## [0.11.2]");
    expect(result).toContain("## [0.11.1]");
    expect(result).toContain("## [0.11.0]");
  });

  it("returns only the target when the installed version is one behind", () => {
    const result = sliceChangelogSince(NOTES, "0.11.1");
    expect(result).toContain("## [0.11.2]");
    expect(result).not.toContain("## [0.11.1]");
  });

  it("tolerates a leading v on the installed version", () => {
    expect(sliceChangelogSince(NOTES, "v0.11.1")).toContain("## [0.11.2]");
    expect(sliceChangelogSince(NOTES, "v0.11.1")).not.toContain("## [0.11.1]");
  });

  it("ignores an Unreleased header", () => {
    const withUnreleased = `## [Unreleased]\n\n## [0.11.2] - 2026-07-24\n\n### Fixed\n- Fix.`;
    const result = sliceChangelogSince(withUnreleased, "0.11.1");
    expect(result).toContain("## [0.11.2]");
    expect(result).not.toContain("Unreleased");
  });

  it("returns a legacy single-section body (no version headers) unchanged", () => {
    const legacy = "### Fixed\n- A single-version note with no header.";
    expect(sliceChangelogSince(legacy, "0.11.1")).toBe(legacy);
  });

  it("falls back to the full body when the installed version is unparseable", () => {
    const result = sliceChangelogSince(NOTES, "not-a-version");
    expect(result).toContain("## [0.11.0]");
  });

  it("returns an empty string for empty input", () => {
    expect(sliceChangelogSince("", "0.11.1")).toBe("");
    expect(sliceChangelogSince(undefined, "0.11.1")).toBe("");
  });
});
