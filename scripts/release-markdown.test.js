import { describe, expect, it } from "vitest";
import { unwrapReleaseListProse } from "./release-markdown.mjs";

describe("release list prose", () => {
  it("unwraps links and emphasis without joining separate items or headings", () => {
    expect(
      unwrapReleaseListProse(
        "### Added\n\n- [Link](https://example.com) curated\n  Themes and **Dialogue\n  Loudness**.\n- Another item.\n\n### Fixed\n"
      )
    ).toBe(
      "### Added\n\n- [Link](https://example.com) curated Themes and **Dialogue Loudness**.\n- Another item.\n\n### Fixed\n"
    );
  });

  it("preserves nested lists, paragraphs, code blocks and explicit hard breaks", () => {
    const markdown = [
      "- Parent:",
      "  - Child",
      "    continued.",
      "",
      "  Second paragraph.",
      "",
      "  ```md",
      "- Literal",
      "  continuation",
      "  ```",
      "",
      "- Hard break  ",
      "  next line.",
      "- Another hard break\\",
      "  next line.",
      "",
      "- Code:",
      "",
      "      const x = 1;",
      "      const y = 2;",
      "",
      "- Quote:",
      "  > quoted",
      "  > text",
      "",
      "1. Numbered",
      "   continued.",
    ].join("\n");
    expect(unwrapReleaseListProse(markdown)).toBe(
      markdown
        .replace("Child\n    continued.", "Child continued.")
        .replace("Numbered\n   continued.", "Numbered continued.")
    );
  });
});
