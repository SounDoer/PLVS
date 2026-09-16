import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPeakMeterChannelLabels } from "./peakMeterChannelLabels.js";
import { roleTokensToLoudnessWeights, seedTokensFromLabels } from "./channelRoles.js";
import { rolesForLayout, standardLayoutIdForCount, weightsForRoles } from "./channelLayoutTable.js";

// Both engine and frontend now read shared/channel-layouts.json rather than carrying their own
// hand-written weight tables, so the drift this contract used to catch (two literal tables
// disagreeing) is structurally impossible. What remains to guard:
// 1. `channel_weights.rs` must not grow a new literal weight-row match arm alongside the shared
//    table — that would silently reintroduce the drift risk.
// 2. The frontend's own per-channel-count label/weight derivation (`getPeakMeterChannelLabels` +
//    `channelRoles.js`, the path the manual role picker and peak meter use) must not drift from
//    reading `shared/channel-layouts.json` directly (`channelLayoutTable.js`'s `rolesForLayout` /
//    `weightsForRoles`) — i.e. the JS twin of Rust's `standard_layout_name` stays in step with the
//    table it is meant to summarize.
const SOURCE_ROOT = dirname(fileURLToPath(import.meta.url));
const RUST_SOURCE = readFileSync(
  join(SOURCE_ROOT, "..", "..", "src-tauri", "src", "dsp", "channel_weights.rs"),
  "utf8"
);

/// The body of Rust's `standard_loudness_weights`, and nothing else: the file also carries a
/// `#[cfg(test)]` module that asserts its own literal rows in its own syntax, which this contract
/// does not police.
function weightsFunctionBody() {
  const start = RUST_SOURCE.indexOf("fn standard_loudness_weights");
  expect(start, "channel_weights.rs declares standard_loudness_weights").toBeGreaterThan(-1);
  const end = RUST_SOURCE.indexOf("\n}\n", start);
  expect(end, "standard_loudness_weights has a body").toBeGreaterThan(start);
  return RUST_SOURCE.slice(start, end);
}

describe("channel weights contract", () => {
  it("standard_loudness_weights carries no literal weight-row match arm", () => {
    expect(weightsFunctionBody()).not.toMatch(/Some\(&\[/);
  });

  for (let n = 1; n <= 8; n++) {
    it(`matches the shared table's ${n}-channel layout`, () => {
      const layoutId = standardLayoutIdForCount(n);
      expect(layoutId, `standard layout id for ${n} channels`).not.toBeNull();

      const roles = rolesForLayout(layoutId);
      const expectedWeights = weightsForRoles(roles);

      // formatId pins the layout explicitly: 8 channels is otherwise ambiguous between 7.1 and
      // 5.1.2, and this contract is specifically about the auto-detected standard layout.
      const labels = getPeakMeterChannelLabels(n, { formatId: layoutId });
      const weights = roleTokensToLoudnessWeights(seedTokensFromLabels(labels));

      expect(labels).toEqual(roles);
      expect(weights).toEqual(expectedWeights);
    });
  }
});
