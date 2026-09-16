import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPeakMeterChannelLabels } from "./peakMeterChannelLabels.js";
import { roleTokensToLoudnessWeights, seedTokensFromLabels } from "./channelRoles.js";

// Keeps the frontend's default channel labels and role loudness weights in step with the
// engine's per-channel weight table, so the two sides cannot silently drift apart.
const SOURCE_ROOT = dirname(fileURLToPath(import.meta.url));
const RUST_SOURCE = readFileSync(
  join(SOURCE_ROOT, "..", "..", "src-tauri", "src", "dsp", "channel_weights.rs"),
  "utf8"
);

const SURROUND_LOUDNESS_WEIGHT = 10 ** (1.5 / 10);

/// The body of Rust's `standard_loudness_weights`, and nothing else: the file also carries a
/// `#[cfg(test)]` module that re-asserts the same rows in its own syntax.
function weightsFunctionBody() {
  const start = RUST_SOURCE.indexOf("fn standard_loudness_weights");
  expect(start, "channel_weights.rs declares standard_loudness_weights").toBeGreaterThan(-1);
  const end = RUST_SOURCE.indexOf("\n}\n", start);
  expect(end, "standard_loudness_weights has a body").toBeGreaterThan(start);
  return RUST_SOURCE.slice(start, end);
}

/// Parses `N => Some(&[ ... ])` match arms into `{ [channelCount]: number[] }`. Rustfmt may spread
/// a row over several lines, so this tolerates whitespace/newlines inside the bracket and ignores
/// `//` comment lines rather than assuming one arm per line.
function parseWeightRows(body) {
  const withoutComments = body
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  const rows = {};
  const rowPattern = /(\d+)\s*=>\s*Some\(&\[([^\]]*)\]\)/g;
  for (const [, channels, tokenList] of withoutComments.matchAll(rowPattern)) {
    const weights = tokenList
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .map((t) => (t === "S" ? SURROUND_LOUDNESS_WEIGHT : Number(t)));
    rows[Number(channels)] = weights;
  }
  return rows;
}

describe("channel weights contract", () => {
  const rows = parseWeightRows(weightsFunctionBody());

  it("has a row for every channel count from 3 to 8, and no others", () => {
    expect(
      Object.keys(rows)
        .map(Number)
        .sort((a, b) => a - b)
    ).toEqual([3, 4, 5, 6, 7, 8]);
  });

  for (let n = 3; n <= 8; n++) {
    it(`matches the engine's ${n}-channel weight row`, () => {
      // 8 channels is ambiguous between 7.1 and 5.1.2 in the shared table; this contract is
      // specifically about the engine's canonical 7.1 row, so name it explicitly.
      const labels = getPeakMeterChannelLabels(n, n === 8 ? { formatId: "7.1" } : undefined);
      const weights = roleTokensToLoudnessWeights(seedTokensFromLabels(labels));
      expect(weights).toEqual(rows[n]);
    });
  }
});
