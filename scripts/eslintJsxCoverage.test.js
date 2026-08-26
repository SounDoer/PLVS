import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

describe("ESLint JSX coverage", () => {
  it("rejects stale hook dependencies in JSX files", async () => {
    const eslint = new ESLint();
    const [result] = await eslint.lintText(
      `
        import { useCallback } from "react";

        export function Probe({ value }) {
          return useCallback(() => value, []);
        }
      `,
      { filePath: "src/eslint-jsx-coverage-probe.jsx" }
    );

    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "react-hooks/exhaustive-deps",
          severity: 2,
        }),
      ])
    );
  });
});
