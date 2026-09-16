# Immersive Channel Layouts (B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recognise 5.1.2 / 5.1.4 / 7.1.2 / 7.1.4 / 9.1.6, let the user pick a layout in Settings, over Agent Control and on the CLI, and report the chosen layout by name.

**Architecture:** One shared JSON table (`shared/channel-layouts.json`) defines every role with its BS.1770-5 weight and every layout as an ordered role list. The frontend imports it; Rust embeds it with `include_str!`. Roles become the interchange: the frontend sends a role list, Rust derives both the weights and the reported layout id. Detection by channel count is unchanged and never guesses above 8 channels.

**Tech Stack:** React 19 + Vite frontend (Vitest), Tauri 2 + Rust backend (cargo test), shared JSON fixtures under `shared/`.

**Spec:** `docs/superpowers/specs/2026-09-16-immersive-channel-layouts-design.md`

---

## File Structure

**Created:**

- `shared/channel-layouts.json` — the single source: role ids, labels, weights; layout ids, names, ordered roles.
- `src/math/channelLayoutTable.js` — frontend accessors over the JSON (`ROLES`, `LAYOUTS`, `layoutIdForRoles`, `rolesForLayout`, `layoutsForChannelCount`).
- `src/math/channelLayoutTable.test.js`
- `src-tauri/src/dsp/channel_layouts.rs` — Rust loader and the same four accessors.

**Modified:**

- `src/math/channelRoles.js` — vocabulary and weights come from the table; helper functions unchanged in signature.
- `src/math/peakMeterChannelLabels.js` — label rows come from the table.
- `src/math/channelLayoutResolver.js` — deleted; its only caller is `App.jsx` (see Task 8).
- `src-tauri/src/dsp/channel_weights.rs` — same public functions, backed by the table.
- `src-tauri/src/dsp/mod.rs` — register `channel_layouts`.
- `src-tauri/src/state.rs` — `loudness_weights` becomes `channel_selection`.
- `src-tauri/src/ipc/commands.rs` — `set_loudness_weights` becomes `set_channel_roles`.
- `src-tauri/src/lib.rs` — command registration.
- `src-tauri/src/engine/meter_pipeline.rs` — layout naming; `ChannelLayoutSetting` removed.
- `src-tauri/src/engine/channel_layout.rs` — deleted.
- `src-tauri/src/engine/mod.rs`, `src-tauri/src/audio/*.rs`, `src-tauri/src/file_analysis/session.rs`, `src-tauri/src/visual_capture/**` — drop the `ChannelLayoutSetting` parameter.
- `src/ipc/commands.js` — `setLoudnessWeights` becomes `setChannelRoles`.
- `src/runtime/appRuntimeDerivations.js`, `src/App.jsx` — role-centred runtime.
- `src/components/SettingsPanel.jsx` — Layout select.
- `src/components/AppShell.jsx` — footer prompt.
- `src/agentControl/settingsControl.js`, `src/agentControl/panelControlSchema.js` — `layout` field.
- `src-tauri/src/cli_analyze.rs`, `src-tauri/src/cli_capture.rs`, `src-tauri/src/cli_main.rs` — `--layout`.
- `docs/prd.md`, `docs/architecture.md`, `docs/cli.md`, `docs/agent-control/measurements.md`.

**Never hand-edited:** `docs/agent-control/generated/`, `src/generated/`.

---

## Task 1: The shared layout table and its Rust loader

**Files:**
- Create: `shared/channel-layouts.json`
- Create: `src-tauri/src/dsp/channel_layouts.rs`
- Modify: `src-tauri/src/dsp/mod.rs`

- [ ] **Step 1: Write the table**

Create `shared/channel-layouts.json`. `weight` is the BS.1770-5 Annex 3 Table 4 energy multiplier; `1.4125375446227544` is `10^(1.5/10)` and equals `SURROUND_LOUDNESS_WEIGHT` in `src-tauri/src/dsp/gating.rs`.

```json
{
  "_comment": "Single source of truth for channel roles and standard channel layouts. Consumed by the frontend (src/math/channelLayoutTable.js) and by Rust (src-tauri/src/dsp/channel_layouts.rs). Weights are ITU-R BS.1770-5 Annex 3 Table 4: 1.41 (+1.5 dB) for |elevation| < 30 with 60 <= |azimuth| <= 120, 1.00 elsewhere, 0 for LFE. Layout role order is the native WAVE (KSAUDIO_SPEAKER_*) / ffmpeg order.",
  "version": 1,
  "roles": [
    { "id": "generic", "label": "—", "weight": 1.0 },
    { "id": "M", "label": "M", "weight": 1.0 },
    { "id": "L", "label": "L", "weight": 1.0 },
    { "id": "R", "label": "R", "weight": 1.0 },
    { "id": "C", "label": "C", "weight": 1.0 },
    { "id": "LFE", "label": "LFE", "weight": 0.0 },
    { "id": "Ls", "label": "Ls", "weight": 1.4125375446227544 },
    { "id": "Rs", "label": "Rs", "weight": 1.4125375446227544 },
    { "id": "Lb", "label": "Lb", "weight": 1.0 },
    { "id": "Rb", "label": "Rb", "weight": 1.0 },
    { "id": "Cs", "label": "Cs", "weight": 1.0 },
    { "id": "Lw", "label": "Lw", "weight": 1.4125375446227544 },
    { "id": "Rw", "label": "Rw", "weight": 1.4125375446227544 },
    { "id": "Ltf", "label": "Ltf", "weight": 1.0 },
    { "id": "Rtf", "label": "Rtf", "weight": 1.0 },
    { "id": "Ltm", "label": "Ltm", "weight": 1.0 },
    { "id": "Rtm", "label": "Rtm", "weight": 1.0 },
    { "id": "Ltr", "label": "Ltr", "weight": 1.0 },
    { "id": "Rtr", "label": "Rtr", "weight": 1.0 }
  ],
  "layouts": [
    { "id": "mono", "name": "Mono", "roles": ["M"] },
    { "id": "stereo", "name": "Stereo", "roles": ["L", "R"] },
    { "id": "lcr", "name": "LCR", "roles": ["L", "R", "C"] },
    { "id": "quad", "name": "Quad", "roles": ["L", "R", "Ls", "Rs"] },
    { "id": "5.0", "name": "5.0", "roles": ["L", "R", "C", "Ls", "Rs"] },
    { "id": "5.1", "name": "5.1", "roles": ["L", "R", "C", "LFE", "Ls", "Rs"] },
    { "id": "7.0", "name": "7.0", "roles": ["L", "R", "C", "Lb", "Rb", "Ls", "Rs"] },
    { "id": "7.1", "name": "7.1", "roles": ["L", "R", "C", "LFE", "Lb", "Rb", "Ls", "Rs"] },
    { "id": "5.1.2", "name": "5.1.2", "roles": ["L", "R", "C", "LFE", "Ls", "Rs", "Ltf", "Rtf"] },
    {
      "id": "5.1.4",
      "name": "5.1.4",
      "roles": ["L", "R", "C", "LFE", "Ls", "Rs", "Ltf", "Rtf", "Ltr", "Rtr"]
    },
    {
      "id": "7.1.2",
      "name": "7.1.2",
      "roles": ["L", "R", "C", "LFE", "Lb", "Rb", "Ls", "Rs", "Ltf", "Rtf"]
    },
    {
      "id": "7.1.4",
      "name": "7.1.4",
      "roles": ["L", "R", "C", "LFE", "Lb", "Rb", "Ls", "Rs", "Ltf", "Rtf", "Ltr", "Rtr"]
    },
    {
      "id": "9.1.6",
      "name": "9.1.6",
      "roles": [
        "L", "R", "C", "LFE", "Lb", "Rb", "Lw", "Rw", "Ls", "Rs",
        "Ltf", "Rtf", "Ltr", "Rtr", "Ltm", "Rtm"
      ]
    }
  ]
}
```

- [ ] **Step 2: Write the failing Rust loader test**

Create `src-tauri/src/dsp/channel_layouts.rs` containing only this test module (no implementation yet):

```rust
#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn every_layout_role_exists_and_weights_follow_bs1770_5() {
    for layout in layouts() {
      for role in &layout.roles {
        let weight = role_weight(role).unwrap_or_else(|| panic!("unknown role {role}"));
        let expected = match role.as_str() {
          "LFE" => 0.0,
          "Ls" | "Rs" | "Lw" | "Rw" => SURROUND_LOUDNESS_WEIGHT,
          _ => 1.0,
        };
        assert_eq!(weight, expected, "{} role {role}", layout.id);
      }
    }
  }

  #[test]
  fn layout_ids_and_channel_counts() {
    let seen: Vec<(&str, usize)> = layouts()
      .iter()
      .map(|l| (l.id.as_str(), l.roles.len()))
      .collect();
    assert_eq!(
      seen,
      vec![
        ("mono", 1),
        ("stereo", 2),
        ("lcr", 3),
        ("quad", 4),
        ("5.0", 5),
        ("5.1", 6),
        ("7.0", 7),
        ("7.1", 8),
        ("5.1.2", 8),
        ("5.1.4", 10),
        ("7.1.2", 10),
        ("7.1.4", 12),
        ("9.1.6", 16),
      ]
    );
  }

  #[test]
  fn nine_one_six_puts_the_surround_weight_only_on_sides_and_wides() {
    let roles = roles_for_layout("9.1.6").expect("9.1.6");
    let weighted: Vec<&str> = roles
      .iter()
      .filter(|r| role_weight(r) == Some(SURROUND_LOUDNESS_WEIGHT))
      .map(|r| r.as_str())
      .collect();
    assert_eq!(weighted, vec!["Lw", "Rw", "Ls", "Rs"]);
  }

  #[test]
  fn layout_id_for_roles_matches_exactly_or_returns_none() {
    let mut roles = roles_for_layout("7.1.4").expect("7.1.4").to_vec();
    assert_eq!(layout_id_for_roles(&roles), Some("7.1.4"));
    roles.swap(4, 6);
    assert_eq!(layout_id_for_roles(&roles), None);
  }

  #[test]
  fn eight_channels_offers_seven_one_before_five_one_two() {
    let ids: Vec<&str> = layouts_for_channel_count(8).iter().map(|l| l.id.as_str()).collect();
    assert_eq!(ids, vec!["7.1", "5.1.2"]);
  }

  #[test]
  fn weights_for_roles_rejects_an_unknown_role() {
    assert_eq!(weights_for_roles(&["L".to_string(), "Nope".to_string()]), None);
  }
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml channel_layouts`
Expected: compile error — `layouts`, `role_weight`, `roles_for_layout`, `layout_id_for_roles`, `layouts_for_channel_count`, `weights_for_roles` are not defined.

- [ ] **Step 4: Implement the loader**

Put this above the test module in `src-tauri/src/dsp/channel_layouts.rs`:

```rust
//! Channel roles and standard layouts, loaded from the shared table in `shared/channel-layouts.json`.
//!
//! The frontend reads the same file through `src/math/channelLayoutTable.js`, so a weight or a
//! layout order exists exactly once in the repository.

use serde::Deserialize;
use std::sync::OnceLock;

pub(crate) use super::gating::SURROUND_LOUDNESS_WEIGHT;

pub const CHANNEL_LAYOUTS_JSON: &str = include_str!("../../../shared/channel-layouts.json");

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct RoleEntry {
  pub id: String,
  pub label: String,
  pub weight: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct LayoutEntry {
  pub id: String,
  pub name: String,
  pub roles: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct ChannelLayoutTable {
  roles: Vec<RoleEntry>,
  layouts: Vec<LayoutEntry>,
}

fn table() -> &'static ChannelLayoutTable {
  static TABLE: OnceLock<ChannelLayoutTable> = OnceLock::new();
  TABLE.get_or_init(|| {
    serde_json::from_str(CHANNEL_LAYOUTS_JSON).expect("shared/channel-layouts.json is valid")
  })
}

pub(crate) fn roles() -> &'static [RoleEntry] {
  &table().roles
}

pub(crate) fn layouts() -> &'static [LayoutEntry] {
  &table().layouts
}

/// Energy multiplier for a role id, or `None` when the id is not in the table.
pub(crate) fn role_weight(role: &str) -> Option<f64> {
  roles().iter().find(|r| r.id == role).map(|r| r.weight)
}

/// Ordered roles of a layout id.
pub(crate) fn roles_for_layout(layout_id: &str) -> Option<&'static [String]> {
  layouts()
    .iter()
    .find(|l| l.id == layout_id)
    .map(|l| l.roles.as_slice())
}

/// The layout whose roles equal `roles`, in order.
pub(crate) fn layout_id_for_roles(roles: &[String]) -> Option<&'static str> {
  layouts()
    .iter()
    .find(|l| l.roles == roles)
    .map(|l| l.id.as_str())
}

/// Layouts with exactly `channels` channels, in table order.
pub(crate) fn layouts_for_channel_count(channels: usize) -> Vec<&'static LayoutEntry> {
  layouts().iter().filter(|l| l.roles.len() == channels).collect()
}

/// Weights for a role list; `None` if any role is unknown.
pub(crate) fn weights_for_roles(roles: &[String]) -> Option<Vec<f64>> {
  roles.iter().map(|r| role_weight(r)).collect()
}
```

Register the module in `src-tauri/src/dsp/mod.rs` next to the other `mod` lines:

```rust
pub(crate) mod channel_layouts;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml channel_layouts`
Expected: 6 tests pass.

Note: `label` and `name` are unused until Task 3 and Task 9; if clippy flags dead code, add `#[allow(dead_code)]` on the struct fields and remove it in those tasks.

- [ ] **Step 6: Commit**

```bash
git add shared/channel-layouts.json src-tauri/src/dsp/channel_layouts.rs src-tauri/src/dsp/mod.rs
git commit -m "feat(dsp): add the shared channel layout table and its Rust loader"
```

---

## Task 2: Frontend accessors over the same table

**Files:**
- Create: `src/math/channelLayoutTable.js`
- Create: `src/math/channelLayoutTable.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/math/channelLayoutTable.test.js`:

```js
import { describe, expect, it } from "vitest";
import {
  CHANNEL_ROLES,
  CHANNEL_LAYOUTS,
  layoutIdForRoles,
  layoutsForChannelCount,
  rolesForLayout,
  roleWeight,
  weightsForRoles,
} from "./channelLayoutTable.js";

const SURROUND = 10 ** (1.5 / 10);

describe("channelLayoutTable", () => {
  it("weights follow BS.1770-5 Table 4", () => {
    for (const layout of CHANNEL_LAYOUTS) {
      for (const role of layout.roles) {
        const expected =
          role === "LFE" ? 0 : ["Ls", "Rs", "Lw", "Rw"].includes(role) ? SURROUND : 1;
        expect(roleWeight(role), `${layout.id} ${role}`).toBe(expected);
      }
    }
  });

  it("lists layouts with their channel counts", () => {
    expect(CHANNEL_LAYOUTS.map((l) => [l.id, l.roles.length])).toEqual([
      ["mono", 1],
      ["stereo", 2],
      ["lcr", 3],
      ["quad", 4],
      ["5.0", 5],
      ["5.1", 6],
      ["7.0", 7],
      ["7.1", 8],
      ["5.1.2", 8],
      ["5.1.4", 10],
      ["7.1.2", 10],
      ["7.1.4", 12],
      ["9.1.6", 16],
    ]);
  });

  it("matches a role list to a layout only when it is exact", () => {
    const roles = [...rolesForLayout("7.1.4")];
    expect(layoutIdForRoles(roles)).toBe("7.1.4");
    [roles[4], roles[6]] = [roles[6], roles[4]];
    expect(layoutIdForRoles(roles)).toBe(null);
  });

  it("offers both 8-channel layouts for 8 channels", () => {
    expect(layoutsForChannelCount(8).map((l) => l.id)).toEqual(["7.1", "5.1.2"]);
    expect(layoutsForChannelCount(9)).toEqual([]);
  });

  it("returns null weights when a role is unknown", () => {
    expect(weightsForRoles(["L", "Nope"])).toBe(null);
    expect(weightsForRoles(["L", "LFE"])).toEqual([1, 0]);
  });

  it("includes the roles the immersive layouts need", () => {
    const ids = CHANNEL_ROLES.map((r) => r.id);
    for (const id of ["Lw", "Rw", "Ltm", "Rtm"]) {
      expect(ids).toContain(id);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/math/channelLayoutTable.test.js`
Expected: FAIL — cannot resolve `./channelLayoutTable.js`.

- [ ] **Step 3: Implement the accessors**

Create `src/math/channelLayoutTable.js`:

```js
/**
 * Channel roles and standard layouts, read from the shared table that Rust also embeds
 * (`src-tauri/src/dsp/channel_layouts.rs`). Weights and layout order live in that file only.
 *
 * @typedef {{ id: string, label: string, weight: number }} ChannelRoleEntry
 * @typedef {{ id: string, name: string, roles: string[] }} ChannelLayoutEntry
 */

import table from "../../shared/channel-layouts.json";

/** @type {readonly ChannelRoleEntry[]} */
export const CHANNEL_ROLES = Object.freeze(table.roles);

/** @type {readonly ChannelLayoutEntry[]} */
export const CHANNEL_LAYOUTS = Object.freeze(table.layouts);

const WEIGHT_BY_ROLE = new Map(CHANNEL_ROLES.map((r) => [r.id, r.weight]));

/**
 * @param {string} role
 * @returns {number | null}
 */
export function roleWeight(role) {
  return WEIGHT_BY_ROLE.has(role) ? WEIGHT_BY_ROLE.get(role) : null;
}

/**
 * @param {string} layoutId
 * @returns {string[]} Empty when the id is unknown.
 */
export function rolesForLayout(layoutId) {
  const layout = CHANNEL_LAYOUTS.find((l) => l.id === layoutId);
  return layout ? [...layout.roles] : [];
}

/**
 * @param {string[]} roles
 * @returns {string | null} The layout whose roles equal `roles`, in order.
 */
export function layoutIdForRoles(roles) {
  if (!Array.isArray(roles)) return null;
  const match = CHANNEL_LAYOUTS.find(
    (l) => l.roles.length === roles.length && l.roles.every((role, i) => role === roles[i])
  );
  return match ? match.id : null;
}

/**
 * @param {number} channels
 * @returns {ChannelLayoutEntry[]} Layouts with exactly this channel count, in table order.
 */
export function layoutsForChannelCount(channels) {
  return CHANNEL_LAYOUTS.filter((l) => l.roles.length === channels);
}

/**
 * @param {string[]} roles
 * @returns {number[] | null} Null when any role is unknown.
 */
export function weightsForRoles(roles) {
  const out = [];
  for (const role of roles) {
    const weight = roleWeight(role);
    if (weight === null) return null;
    out.push(weight);
  }
  return out;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/math/channelLayoutTable.test.js`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/math/channelLayoutTable.js src/math/channelLayoutTable.test.js
git commit -m "feat(math): read channel roles and layouts from the shared table"
```

---

## Task 3: Point the existing frontend role and label modules at the table

**Files:**
- Modify: `src/math/channelRoles.js`
- Modify: `src/math/peakMeterChannelLabels.js`
- Test: `src/math/channelRoles.test.js`, `src/math/peakMeterChannelLabels.test.js` (existing)

- [ ] **Step 1: Add the failing tests**

Append to `src/math/channelRoles.test.js`:

```js
it("carries the immersive roles with their BS.1770-5 weights", () => {
  expect(roleTokensToLoudnessWeights(["Lw", "Rw", "Ltm", "Rtm"])).toEqual([
    10 ** (1.5 / 10),
    10 ** (1.5 / 10),
    1,
    1,
  ]);
  expect(roleTokensToLabels(["Lw", "Ltm"])).toEqual(["Lw", "Ltm"]);
});
```

Append to `src/math/peakMeterChannelLabels.test.js`:

```js
it("labels a 12-channel 7.1.4 layout from the shared table", () => {
  expect(getPeakMeterChannelLabels(12, { formatId: "7.1.4" })).toEqual([
    "L",
    "R",
    "C",
    "LFE",
    "Lb",
    "Rb",
    "Ls",
    "Rs",
    "Ltf",
    "Rtf",
    "Ltr",
    "Rtr",
  ]);
});

it("does not name channels for a count with no single standard layout", () => {
  expect(getPeakMeterChannelLabels(10)).toEqual(
    Array.from({ length: 10 }, (_, i) => `Ch ${i + 1}`)
  );
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/math/channelRoles.test.js src/math/peakMeterChannelLabels.test.js`
Expected: FAIL — `Lw` is not in the vocabulary; `formatId: "7.1.4"` is unknown.

- [ ] **Step 3: Rewrite the two modules over the table**

In `src/math/channelRoles.js`, delete `CHANNEL_ROLE_VOCABULARY`'s literal array, the `SURROUND_LOUDNESS_WEIGHT` constant and `LOUDNESS_WEIGHT_BY_ROLE_ID`, and derive them:

```js
import { CHANNEL_ROLES, roleWeight } from "./channelLayoutTable.js";

/** @type {readonly ChannelRole[]} */
export const CHANNEL_ROLE_VOCABULARY = Object.freeze(
  CHANNEL_ROLES.map(({ id, label }) => ({ id, label }))
);
```

and make the weight helper read the table:

```js
export function roleTokensToLoudnessWeights(tokens) {
  return tokens.map((token) => roleWeight(token) ?? 1);
}
```

`roleTokensToLabels`, `seedTokensFromLabels`, `sanitizeChannelLabelOverrides` and `VALID_IDS` keep their current bodies — they already derive from `CHANNEL_ROLE_VOCABULARY`.

In `src/math/peakMeterChannelLabels.js`, replace `PEAK_METER_CHANNEL_FORMATS` and `ORDERED_FORMAT_IDS` with table-derived values, keyed by layout id:

```js
import { CHANNEL_LAYOUTS, layoutsForChannelCount, rolesForLayout } from "./channelLayoutTable.js";

/** @type {Record<string, PeakMeterChannelFormatDef>} */
export const PEAK_METER_CHANNEL_FORMATS = Object.freeze(
  Object.fromEntries(
    CHANNEL_LAYOUTS.map((layout) => [
      layout.id,
      { id: layout.id, channels: layout.roles.length, labels: [...layout.roles] },
    ])
  )
);

/**
 * @param {number} channelCount
 * @returns {string[] | null} Null unless exactly one layout has this channel count: 8 channels is
 * 7.1 or 5.1.2 and must not be named by count alone.
 */
function labelsForExactChannelCount(channelCount) {
  const matches = layoutsForChannelCount(Math.max(0, Math.floor(channelCount)));
  return matches.length === 1 ? [...matches[0].roles] : null;
}
```

`getPeakMeterChannelLabels` keeps its body; its `ctx.formatId` lookup now takes layout ids. Its `ctx.channelLayout` / `ctx.resolvedLayout` parameters stay for now and are removed in Task 8.

Note for the implementer: 8 channels previously produced `7.1` labels by count. It still does, because Task 8 passes the resolved layout id explicitly for auto-detected counts; `labelsForExactChannelCount` is only the fallback.

- [ ] **Step 4: Run the suites to verify they pass**

Run: `npx vitest run src/math/`
Expected: PASS. Update any existing expectation that referenced the old format ids (`surround51`, `surround71`, …) to the layout ids (`5.1`, `7.1`, …) — this is a deliberate rename, not a loosening.

- [ ] **Step 5: Commit**

```bash
git add src/math/channelRoles.js src/math/channelRoles.test.js src/math/peakMeterChannelLabels.js src/math/peakMeterChannelLabels.test.js
git commit -m "refactor(math): derive roles and peak meter labels from the shared table"
```

---

## Task 4: Back `channel_weights.rs` with the table

**Files:**
- Modify: `src-tauri/src/dsp/channel_weights.rs`

- [ ] **Step 1: Add the failing test**

Add to the test module in `src-tauri/src/dsp/channel_weights.rs`:

```rust
#[test]
fn standard_rows_come_from_the_shared_table() {
  for channels in 1..=8_u16 {
    let name = standard_layout_name(channels).expect("name for 1..=8");
    let roles = crate::dsp::channel_layouts::roles_for_layout(name).expect("layout in table");
    assert_eq!(roles.len(), channels as usize, "{channels} channels");
    if channels >= 3 {
      let expected = crate::dsp::channel_layouts::weights_for_roles(roles).expect("weights");
      assert_eq!(standard_loudness_weights(channels), Some(&expected[..]));
      // The row is cached, so repeated calls hand out the same slice rather than a new one.
      assert!(std::ptr::eq(
        standard_loudness_weights(channels).unwrap(),
        standard_loudness_weights(channels).unwrap()
      ));
    }
  }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml channel_weights`
Expected: FAIL — `standard_loudness_weights` returns a `&'static [f64]` built by hand that is not tied to the table, and `standard_layout_name(8)` returns `"7.1"` while the table lookup path is not wired; the assertion on the borrow will not compile against a temporary.

- [ ] **Step 3: Reimplement over the table**

Replace the bodies in `src-tauri/src/dsp/channel_weights.rs`, keeping both function names and their meaning ("no standard layout" is `None`):

**`standard_loudness_weights` must keep returning `&'static [f64]`.** `LoudnessMeter::push_interleaved_multichannel` (`src-tauri/src/dsp/loudness.rs:395`) calls it on every PCM chunk, from the capture bridge worker. Returning a `Vec` there would allocate at chunk rate on the DSP hot path. The weight rows are therefore derived from the table once and cached for the process lifetime, so the signature and every call site stay exactly as they are.

Add the cache to `src-tauri/src/dsp/channel_layouts.rs`:

```rust
/// Weights for a layout id, computed once and kept for the process lifetime so hot callers can
/// hold a `'static` slice instead of allocating a row per audio chunk.
pub(crate) fn static_weights_for_layout(layout_id: &str) -> Option<&'static [f64]> {
  static ROWS: OnceLock<Vec<(String, Vec<f64>)>> = OnceLock::new();
  let rows = ROWS.get_or_init(|| {
    layouts()
      .iter()
      .filter_map(|l| weights_for_roles(&l.roles).map(|w| (l.id.clone(), w)))
      .collect()
  });
  rows
    .iter()
    .find(|(id, _)| id == layout_id)
    .map(|(_, weights)| weights.as_slice())
}
```

Then in `src-tauri/src/dsp/channel_weights.rs`:

```rust
use super::channel_layouts::{layouts_for_channel_count, static_weights_for_layout};

/// Layout name for a channel count, or `None` when the count has no single standard layout.
/// 8 channels is 7.1 or 5.1.2; the count alone never decides, so auto detection keeps the first
/// table entry (7.1), which is the pre-B1 behaviour. Counts above 8 are `None` — see this
/// function's callers for the `Ch 1–2` degradation that follows.
pub(crate) fn standard_layout_name(channels: u16) -> Option<&'static str> {
  match channels {
    1..=8 => layouts_for_channel_count(channels as usize)
      .first()
      .map(|l| l.id.as_str()),
    _ => None,
  }
}

/// Per-channel loudness weights for 3–8 channels. Mono and stereo keep their dedicated paths.
/// The returned slice is cached, so this is allocation-free for per-chunk callers.
pub(crate) fn standard_loudness_weights(channels: u16) -> Option<&'static [f64]> {
  if !(3..=8).contains(&channels) {
    return None;
  }
  static_weights_for_layout(standard_layout_name(channels)?)
}
```

The signature is unchanged, so `src-tauri/src/dsp/loudness.rs` and `src-tauri/src/dsp/summary_meter.rs` need no edits. Existing tests keep their `Some(&[...][..])` shape and their numeric values.

**Rewrite the cross-side guard.** `src/math/channelWeightsContract.test.js` scrapes `channel_weights.rs` for `N => Some(&[…])` match arms and compares them with the frontend's weights. Those arms are exactly what this task deletes, so the test goes red. Do not delete the test: the drift it guarded is now structurally impossible, but two new invariants deserve the same protection. Rewrite it to assert:

1. `channel_weights.rs` carries no literal weight rows any more — a hand-written table must not creep back in beside the shared one.
2. For every channel count 1–8, the frontend's labels and weights for `standardLayoutIdForCount(n)` equal that layout's roles and `weightsForRoles` output from `shared/channel-layouts.json`. This is the guard that the JS twin of Rust's `standard_layout_name` has not drifted from the table.

Keep the file's existing comment style and its name; update the leading comment to say what it now guards.

**Also:** removing the hardcoded arms leaves `SURROUND_LOUDNESS_WEIGHT` in `src-tauri/src/dsp/gating.rs` with no production caller, which trips `clippy -D warnings`. Prefer deleting the constant and sourcing the value from the table (`role_weight("Ls")`) in the tests that still reference it, so the +1.5 dB value lives in one place. If that turns out to touch more than the handful of test sites, keep the constant with a narrow `#[allow(dead_code)]` and a comment, and report which you chose.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib dsp`
Expected: PASS, including A's existing 7.1 back-surround test (`a 7.1 signal only in Lb/Rb reads 1.5 LU lower than the same signal only in Ls/Rs`).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/dsp/channel_weights.rs src-tauri/src/dsp/loudness.rs src-tauri/src/dsp/meter.rs
git commit -m "refactor(dsp): back the standard weight rows with the shared table"
```

---

## Task 5: Carry roles over IPC instead of weights

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/ipc/commands.rs:293-340`
- Modify: `src-tauri/src/lib.rs:108`

The audio callback must not gain work: the weights and the layout id are derived **once**, when the command is received, and stored beside the roles.

- [ ] **Step 1: Write the failing test**

Add to the test module in `src-tauri/src/ipc/commands.rs`:

```rust
#[test]
fn channel_selection_derives_weights_and_a_layout_name() {
  let roles: Vec<String> = ["L", "R", "C", "LFE", "Lb", "Rb", "Ls", "Rs"]
    .iter()
    .map(|s| s.to_string())
    .collect();
  let selection = ChannelSelection::from_roles(roles.clone()).expect("valid roles");
  assert_eq!(selection.layout, "7.1");
  assert_eq!(selection.weights.len(), 8);
  assert_eq!(selection.weights[3], 0.0);

  let mut swapped = roles;
  swapped.swap(4, 6);
  let custom = ChannelSelection::from_roles(swapped).expect("valid roles");
  assert_eq!(custom.layout, "custom");

  assert!(ChannelSelection::from_roles(vec!["Nope".to_string()]).is_none());
  assert!(ChannelSelection::from_roles(Vec::new()).is_none());
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml channel_selection`
Expected: compile error — `ChannelSelection` is not defined.

- [ ] **Step 3: Implement the selection type and the command**

In `src-tauri/src/ipc/commands.rs`, replace `validate_loudness_weights` and `set_loudness_weights` with:

```rust
/// A user channel-role selection, with everything the audio path needs derived up front so the
/// callback never looks anything up.
#[derive(Debug, Clone, PartialEq)]
pub struct ChannelSelection {
  pub roles: Vec<String>,
  pub weights: Vec<f64>,
  /// The matching layout id, or `"custom"`.
  pub layout: &'static str,
}

impl ChannelSelection {
  pub fn from_roles(roles: Vec<String>) -> Option<Self> {
    if roles.is_empty() || roles.len() > 64 {
      return None;
    }
    let weights = crate::dsp::channel_layouts::weights_for_roles(&roles)?;
    let layout = crate::dsp::channel_layouts::layout_id_for_roles(&roles).unwrap_or("custom");
    Some(Self {
      roles,
      weights,
      layout,
    })
  }
}

#[tauri::command]
pub fn set_channel_roles(
  roles: Option<Vec<String>>,
  state: State<'_, AppState>,
) -> Result<(), String> {
  let selection = match roles {
    Some(roles) => Some(
      ChannelSelection::from_roles(roles).ok_or_else(|| "invalid channel roles".to_string())?,
    ),
    None => None,
  };
  let mut g = state
    .inner()
    .channel_selection
    .lock()
    .map_err(|_| "channel selection lock poisoned".to_string())?;
  *g = selection;
  Ok(())
}
```

In `src-tauri/src/state.rs`, rename the field:

```rust
pub channel_selection: std::sync::Arc<std::sync::Mutex<Option<crate::ipc::commands::ChannelSelection>>>,
```

In `src-tauri/src/lib.rs`, replace `ipc::commands::set_loudness_weights` with `ipc::commands::set_channel_roles` in the handler list.

- [ ] **Step 4: Run it to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml channel_selection`
Expected: PASS. The workspace will not build yet — Task 6 updates the consumers.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/ipc/commands.rs src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "feat(ipc): accept channel roles and derive weights and layout once"
```

---

## Task 6: Report the selected layout and delete `ChannelLayoutSetting`

**Files:**
- Modify: `src-tauri/src/engine/meter_pipeline.rs:45-59,340-350,680-725`
- Delete: `src-tauri/src/engine/channel_layout.rs`
- Modify: `src-tauri/src/engine/mod.rs`, `src-tauri/src/audio/capture.rs`, `src-tauri/src/audio/cpal_backend.rs`, `src-tauri/src/audio/macos/mod.rs`, `src-tauri/src/audio/platform_backend.rs`, `src-tauri/src/file_analysis/session.rs`, `src-tauri/src/visual_capture/recording/audio.rs`, `src-tauri/src/dsp/loudness.rs`, `src-tauri/src/dsp/meter.rs`

- [ ] **Step 1: Write the failing tests**

Add to the test module in `src-tauri/src/engine/meter_pipeline.rs`:

```rust
#[test]
fn a_selected_layout_is_reported_by_name() {
  let roles: Vec<String> = ["L", "R", "C", "LFE", "Lb", "Rb", "Ls", "Rs", "Ltf", "Rtf", "Ltr", "Rtr"]
    .iter()
    .map(|s| s.to_string())
    .collect();
  let selection = crate::ipc::commands::ChannelSelection::from_roles(roles).expect("roles");
  assert_eq!(loudness_layout_meta(12, Some(&selection)), ("7.1.4".to_string(), true));
}

#[test]
fn a_selection_of_the_wrong_length_falls_back_to_auto_detection() {
  let selection =
    crate::ipc::commands::ChannelSelection::from_roles(vec!["L".to_string(), "R".to_string()])
      .expect("roles");
  assert_eq!(loudness_layout_meta(12, Some(&selection)), ("unknown".to_string(), false));
  assert_eq!(loudness_layout_meta(8, Some(&selection)), ("7.1".to_string(), true));
}

#[test]
fn auto_detection_is_unchanged_without_a_selection() {
  assert_eq!(loudness_layout_meta(8, None), ("7.1".to_string(), true));
  assert_eq!(loudness_layout_meta(6, None), ("5.1".to_string(), true));
  assert_eq!(loudness_layout_meta(12, None), ("unknown".to_string(), false));
  assert_eq!(loudness_layout_meta(16, None), ("unknown".to_string(), false));
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml loudness_layout`
Expected: compile error — `loudness_layout_meta` still takes a `ChannelLayoutSetting`.

- [ ] **Step 3: Rewrite layout naming and drop the enum**

Replace `loudness_layout_meta` in `src-tauri/src/engine/meter_pipeline.rs`:

```rust
fn loudness_layout_meta(
  channels: u16,
  selection: Option<&crate::ipc::commands::ChannelSelection>,
) -> (String, bool) {
  let ch = channels.max(1);
  match selection {
    Some(selection) if selection.roles.len() == ch as usize => {
      (selection.layout.to_string(), true)
    }
    _ => match standard_layout_name(ch) {
      Some(name) => (name.to_string(), true),
      None => ("unknown".to_string(), false),
    },
  }
}
```

In the push path (around lines 690–717), delete the `effective_layout` block and the `dynamic_loudness_active` / `("custom", true)` branch. The parameter that was `loudness_weights: Option<Vec<f64>>` becomes `channel_selection: Option<ChannelSelection>`; the DSP still receives `selection.weights` when `selection.roles.len() == ch`, and the reset-on-change comparison compares selections instead of weights:

```rust
let selection = channel_selection
  .as_ref()
  .filter(|s| s.roles.len() == ch as usize);

if channel_selection != self.last_channel_selection {
  self.loudness.reset();
  self.last_loudness = None;
  self.pending_loudness_hist = None;
  self.m_max = f64::NEG_INFINITY;
  self.st_max = f64::NEG_INFINITY;
  self.last_channel_selection = channel_selection.clone();
}

let (loudness_layout, loudness_layout_known) = loudness_layout_meta(ch, selection);
```

Delete `src-tauri/src/engine/channel_layout.rs` and its `mod` line in `src-tauri/src/engine/mod.rs`. Remove the `ChannelLayoutSetting` parameter from every signature that carries it: `LoudnessMeter::push_interleaved_multichannel` and the `SummaryMeter` path in `src-tauri/src/dsp/`, the capture backends, `file_analysis/session.rs`'s `WorkerConfig`, and `visual_capture/recording/audio.rs`. In `visual_capture/recording/audio.rs`, `effective_layout` and `downmix_frame` currently branch on the enum: keep their 6- and 8-channel behaviour by branching on the channel count instead, which is what B3 will replace.

- [ ] **Step 4: Run the Rust suite to verify it passes**

Run: `npm run rust:test`
Expected: PASS. Existing tests that constructed `ChannelLayoutSetting::Surround51` / `Surround71` are updated to pass the channel count only; their numeric expectations must not change.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src
git commit -m "feat(engine): report the selected layout by name and drop ChannelLayoutSetting"
```

---

## Task 7: Send roles from the frontend

**Files:**
- Modify: `src/ipc/commands.js:238-241`
- Modify: `src/runtime/appRuntimeDerivations.js:44-74`
- Modify: `src/App.jsx:1117,1223-1230,1373,1580-1610`
- Test: `src/ipc/commands.test.js`, `src/runtime/appRuntimeDerivations.test.js`

- [ ] **Step 1: Write the failing tests**

In `src/ipc/commands.test.js`, replace the `set_loudness_weights` expectation with:

```js
it("sends channel roles", async () => {
  await setChannelRoles(["L", "R"]);
  expect(invoke).toHaveBeenCalledWith("set_channel_roles", { roles: ["L", "R"] });
  await setChannelRoles(null);
  expect(invoke).toHaveBeenCalledWith("set_channel_roles", { roles: null });
});
```

In `src/runtime/appRuntimeDerivations.test.js`:

```js
it("exposes the selected layout id and the roles to send", () => {
  const roles = ["L", "R", "C", "LFE", "Lb", "Rb", "Ls", "Rs", "Ltf", "Rtf", "Ltr", "Rtr"];
  const runtime = deriveChannelLabelRuntime({
    channelCount: 12,
    channelLabelOverrides: { 12: roles },
  });
  expect(runtime.channelRoles).toEqual(roles);
  expect(runtime.selectedLayoutId).toBe("7.1.4");
  expect(runtime.overrideLabels).toEqual(roles);
});

it("reports no layout and no roles when nothing is overridden", () => {
  const runtime = deriveChannelLabelRuntime({ channelCount: 12, channelLabelOverrides: {} });
  expect(runtime.channelRoles).toBe(null);
  expect(runtime.selectedLayoutId).toBe(null);
  expect(runtime.channelLabelTokens).toEqual(Array.from({ length: 12 }, () => "generic"));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/ipc/commands.test.js src/runtime/appRuntimeDerivations.test.js`
Expected: FAIL — `setChannelRoles` is not exported; `channelRoles` / `selectedLayoutId` are undefined.

- [ ] **Step 3: Implement**

In `src/ipc/commands.js`:

```js
/** @param {string[] | null} roles */
export function setChannelRoles(roles) {
  return invoke("set_channel_roles", { roles });
}
```

In `src/runtime/appRuntimeDerivations.js`, `deriveChannelLabelRuntime` drops its `layoutResolution` argument and returns roles instead of weights:

```js
import { layoutIdForRoles } from "../math/channelLayoutTable.js";

export function deriveChannelLabelRuntime({ channelCount, channelLabelOverrides }) {
  const channelLabelOverride =
    channelCount > 0 ? (channelLabelOverrides[channelCount] ?? null) : null;
  const overrideLabels = channelLabelOverride ? roleTokensToLabels(channelLabelOverride) : null;
  const autoLayoutId = channelCount > 0 ? standardLayoutIdForCount(channelCount) : null;
  const channelAutoLabels =
    channelCount > 0
      ? getPeakMeterChannelLabels(channelCount, { formatId: autoLayoutId ?? undefined })
      : [];

  return {
    channelLabelOverride,
    channelRoles: channelLabelOverride,
    selectedLayoutId: channelLabelOverride ? layoutIdForRoles(channelLabelOverride) : null,
    overrideLabels,
    channelAutoLabels,
    channelLabelTokens: channelLabelOverride ?? seedTokensFromLabels(channelAutoLabels),
    peakLabelContext: { formatId: autoLayoutId ?? undefined, overrideLabels },
  };
}
```

Add `standardLayoutIdForCount` to `src/math/channelLayoutTable.js` — it is the frontend twin of Rust's `standard_layout_name`, and the shared table makes the duplication mechanical:

```js
/**
 * @param {number} channels
 * @returns {string | null} The auto-detected layout: the sole layout with this channel count, or
 * `7.1` for 8 channels, which is also 5.1.2 and keeps its pre-B1 reading. Null above 8.
 */
export function standardLayoutIdForCount(channels) {
  if (!(channels >= 1 && channels <= 8)) return null;
  const matches = layoutsForChannelCount(Math.floor(channels));
  return matches.length > 0 ? matches[0].id : null;
}
```

Add its test to `src/math/channelLayoutTable.test.js`:

```js
it("auto-detects by count only up to 8 channels", () => {
  expect(standardLayoutIdForCount(6)).toBe("5.1");
  expect(standardLayoutIdForCount(8)).toBe("7.1");
  expect(standardLayoutIdForCount(12)).toBe(null);
});
```

In `src/App.jsx`: delete the `resolveChannelLayout` import and `layoutResolution` (and `src/math/channelLayoutResolver.js` with its test — `App.jsx` is its only caller; confirm with `rg resolveChannelLayout src`), pass only `channelCount` and `channelLabelOverrides` to `deriveChannelLabelRuntime`, and replace every `setLoudnessWeights(...)` call with `setChannelRoles(channelLabelRuntime.channelRoles)`. In `measurementChannelLabels` (line ~1219) drop `channelLayout` / `resolvedLayout` and pass `formatId: standardLayoutIdForCount(count) ?? undefined` with the existing `overrideLabels`.

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npx vitest run src/`
Expected: PASS. Tests that asserted on `loudnessWeights` from this runtime now assert on `channelRoles`.

- [ ] **Step 5: Commit**

```bash
git add src/ipc/commands.js src/ipc/commands.test.js src/runtime src/App.jsx src/math
git commit -m "feat(ipc): send channel roles from the frontend"
```

---

## Task 8: The Layout select in Settings

**Files:**
- Modify: `src/components/SettingsPanel.jsx:524-584`
- Modify: `src/App.jsx:1580-1610,2342-2346`
- Test: `src/components/SettingsPanel.test.jsx`

- [ ] **Step 1: Write the failing test**

Add to `src/components/SettingsPanel.test.jsx` (the file already carries `/** @vitest-environment jsdom */`; add it if absent):

```jsx
it("offers only the layouts matching the channel count and reports Custom for edited roles", () => {
  const setChannelLayout = vi.fn();
  const { rerender } = render(
    <SettingsPanel
      {...baseProps}
      channelCount={12}
      channelLabelTokens={[
        "L", "R", "C", "LFE", "Lb", "Rb", "Ls", "Rs", "Ltf", "Rtf", "Ltr", "Rtr",
      ]}
      selectedLayoutId="7.1.4"
      setChannelLayout={setChannelLayout}
    />
  );
  const layoutSelect = screen.getByLabelText("channel layout");
  expect(layoutSelect).toHaveValue("7.1.4");
  expect(
    [...layoutSelect.querySelectorAll("option")].map((o) => o.value)
  ).toEqual(["7.1.4", "custom"]);

  rerender(
    <SettingsPanel
      {...baseProps}
      channelCount={12}
      channelLabelTokens={[
        "L", "R", "C", "LFE", "Ls", "Rs", "Lb", "Rb", "Ltf", "Rtf", "Ltr", "Rtr",
      ]}
      selectedLayoutId={null}
      setChannelLayout={setChannelLayout}
    />
  );
  expect(screen.getByLabelText("channel layout")).toHaveValue("custom");
});
```

If the existing suite drives the shadcn `Select` through its trigger rather than a native `<option>` list, follow that file's established pattern instead and assert on the trigger's rendered text; do not introduce a second interaction style.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/SettingsPanel.test.jsx`
Expected: FAIL — no element labelled `channel layout`.

- [ ] **Step 3: Implement the select**

In `src/components/SettingsPanel.jsx`, add `selectedLayoutId` and `setChannelLayout` to the props list, and render a row above the per-channel list, inside the existing `channelCount > 0` block:

```jsx
<SettingsRow labelNode={<span className={ROW_LABEL_CLASS}>Layout</span>}>
  <Select
    value={selectedLayoutId ?? "custom"}
    onValueChange={(v) => setChannelLayout(v)}
  >
    <SelectTrigger className={SELECT_TRIGGER_CLASS} aria-label="channel layout">
      <SelectValue />
    </SelectTrigger>
    <SelectContent position="popper" className={SELECT_CONTENT_CLASS}>
      {layoutsForChannelCount(channelCount).map((layout) => (
        <SelectItem key={layout.id} value={layout.id}>
          {layout.name}
        </SelectItem>
      ))}
      <SelectItem value="custom">Custom</SelectItem>
    </SelectContent>
  </Select>
</SettingsRow>
```

Import `layoutsForChannelCount` from `../math/channelLayoutTable.js`.

In `src/App.jsx`, beside `setChannelLabelToken`, add the handler and pass both new props through at line ~2342:

```jsx
const setChannelLayout = useCallback(
  (layoutId) => {
    if (layoutId === "custom") return;
    const roles = rolesForLayout(layoutId);
    if (roles.length !== channelCount) return;
    setChannelLabelOverrides((prev) => ({ ...prev, [channelCount]: roles }));
  },
  [channelCount, setChannelLabelOverrides]
);
```

Selecting `Custom` is a no-op: it is a status, not a command. Editing a per-channel role already writes the override, and `selectedLayoutId` becomes `null`, which renders as `Custom`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/components/SettingsPanel.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsPanel.jsx src/components/SettingsPanel.test.jsx src/App.jsx
git commit -m "feat(settings): add a channel Layout select that fills the per-channel roles"
```

---

## Task 9: The footer prompt

**Files:**
- Modify: `src/components/AppShell.jsx:145-156`
- Modify: `src/App.jsx:2281-2292`
- Test: `src/components/AppShell.test.jsx`

- [ ] **Step 1: Write the failing test**

Add to `src/components/AppShell.test.jsx`:

```jsx
it("prompts for a layout only when one is unknown and channels are present", () => {
  const onOpenSettings = vi.fn();
  const { rerender } = render(
    <AppShell
      {...baseProps}
      footer={{ ...baseFooter, layoutUnknown: true, onOpenSettings }}
    />
  );
  const prompt = screen.getByRole("button", { name: /channel layout unknown/i });
  fireEvent.click(prompt);
  expect(onOpenSettings).toHaveBeenCalled();

  rerender(
    <AppShell {...baseProps} footer={{ ...baseFooter, layoutUnknown: false, onOpenSettings }} />
  );
  expect(screen.queryByRole("button", { name: /channel layout unknown/i })).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/AppShell.test.jsx`
Expected: FAIL — no such button.

- [ ] **Step 3: Implement**

In `src/components/AppShell.jsx`, after the `footer.hasUpdate` block:

```jsx
{footer.layoutUnknown ? (
  <>
    <div className={FOOTER_DIVIDER} />
    <button
      type="button"
      onClick={footer.onOpenSettings}
      className="min-w-0 truncate text-[length:var(--ui-fs-status)] text-primary hover:underline"
    >
      Channel layout unknown · Set in Settings
    </button>
  </>
) : null}
```

In `src/App.jsx`, add to the `footer` object:

```jsx
layoutUnknown: channelCount > 0 && displayAudio?.loudnessLayoutKnown === false,
```

Use the same `displayAudio` the Stats panel reads (`src/components/panels/StatsPanel.jsx:116`), so live and file analysis behave alike. Only an explicit `false` shows the prompt, matching `LoudnessLayoutMarker`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/components/AppShell.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/AppShell.jsx src/components/AppShell.test.jsx src/App.jsx
git commit -m "feat(shell): prompt for a channel layout in the footer when it is unknown"
```

---

## Task 10: Agent Control `layout`

**Files:**
- Modify: `src/agentControl/settingsControl.js:44-130,220-260`
- Modify: `src/App.jsx:1188-1196,1373`
- Test: `src/agentControl/settingsControl.test.js`

- [ ] **Step 1: Write the failing test**

Add to `src/agentControl/settingsControl.test.js`:

```js
it("reads the derived layout and writes roles from a layout", () => {
  const context = {
    channelCount: 12,
    channelLabelMode: "custom",
    channelLabelRoles: [
      "L", "R", "C", "LFE", "Lb", "Rb", "Ls", "Rs", "Ltf", "Rtf", "Ltr", "Rtr",
    ],
  };
  const settings = buildPublicSettings(baseSettings, context);
  expect(settings.channelLabels.layout).toBe("7.1.4");

  const applied = applySettingsPatch(settings, {
    channelLabels: { channelCount: 12, mode: "custom", layout: "5.1.4" },
  });
  expect(applied.issues).toEqual([]);
  expect(applied.next.channelLabels.roles).toEqual([
    "L", "R", "C", "LFE", "Ls", "Rs", "Ltf", "Rtf", "Ltr", "Rtr",
  ]);
});

it("refuses a patch that sets both layout and roles", () => {
  const applied = applySettingsPatch(baseSettings, {
    channelLabels: { channelCount: 2, mode: "custom", layout: "stereo", roles: ["L", "R"] },
  });
  expect(applied.issues.map((i) => i.path)).toContain("$.channelLabels.layout");
});

it("refuses a layout whose channel count does not match", () => {
  const applied = applySettingsPatch(baseSettings, {
    channelLabels: { channelCount: 12, mode: "custom", layout: "5.1" },
  });
  expect(applied.issues.map((i) => i.code)).toContain("invalidOption");
});
```

Match the existing helper names in that file (`applySettingsPatch` may be named differently; use what the file exports) and reuse its `baseSettings` fixture.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/agentControl/settingsControl.test.js`
Expected: FAIL — `layout` is rejected as an unknown control.

- [ ] **Step 3: Implement**

In `src/agentControl/settingsControl.js`:

- `buildPublicSettings`: add `layout: layoutIdForRoles(context.channelLabelRoles) ?? "custom"` to the `channelLabels` object.
- `buildSettingsSchema`: add a `layout` property — `{ type: "enum", current: settings.channelLabels.layout, options: [...layoutsForChannelCount(context.channelCount).map((l) => l.id), "custom"] }`.
- Validation: add `"layout"` to the `allowed` key set; reject `layout` together with `roles` (`issue("invalidOption", "$.channelLabels.layout", "layout and roles cannot both be set.")`); reject a `layout` whose `rolesForLayout(layout).length !== value.channelCount`; reject `layout` when `mode` is `"auto"`, with the same wording the existing `rolesNotAllowed` branch uses for roles.
- When a valid `layout` is present, set `nextChannelLabels.roles = rolesForLayout(value.layout)`.

In `src/App.jsx`, the patch application at line ~1373 sends roles rather than weights:

```js
if (changed.includes("settings.channelLabels")) {
  const nextRoles = next.channelLabels.roles ?? null;
  if (JSON.stringify(nextRoles) !== JSON.stringify(channelLabelRuntime.channelRoles)) {
    await setChannelRolesForControl(nextRoles);
    compensation.push(() => setChannelRolesForControl(channelLabelRuntime.channelRoles));
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/agentControl/`
Expected: PASS.

- [ ] **Step 5: Regenerate the Agent Control docs**

Run: `npm run docs:agent-control`
Expected: `docs/agent-control/generated/` updates to include `layout`. Never edit those files by hand.

- [ ] **Step 6: Commit**

```bash
git add src/agentControl src/App.jsx docs/agent-control/generated
git commit -m "feat(agent-control): expose the channel layout beside the per-channel roles"
```

---

## Task 11: `--layout` on the standalone CLI

**Files:**
- Modify: `src-tauri/src/cli_analyze.rs:44-50`
- Modify: `src-tauri/src/cli_capture.rs`
- Modify: `src-tauri/src/cli_main.rs:143-280`
- Modify: `docs/cli.md`

- [ ] **Step 1: Write the failing test**

Add to the test module in `src-tauri/src/cli_main.rs`:

```rust
#[test]
fn analyze_accepts_a_layout_id_and_rejects_an_unknown_one() {
  let parsed = parse_analyze_args(&args(&["mix.wav", "--json", "--layout", "7.1.4"]));
  match parsed {
    Ok(CliCommand::Analyze { options, .. }) => {
      assert_eq!(options.layout.as_deref(), Some("7.1.4"));
    }
    other => panic!("unexpected parse: {other:?}"),
  }

  let bad = parse_analyze_args(&args(&["mix.wav", "--json", "--layout", "9.9.9"]));
  assert!(bad.is_err(), "unknown layout must not parse");
}
```

Add to the test module in `src-tauri/src/cli_analyze.rs`:

```rust
#[test]
fn a_layout_whose_channel_count_does_not_match_is_an_error() {
  let err = layout_weights_for("5.1", 12).expect_err("channel count mismatch");
  assert!(err.contains("5.1"), "message names the layout: {err}");
  let weights = layout_weights_for("7.1.4", 12).expect("matching layout");
  assert_eq!(weights.len(), 12);
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml layout`
Expected: compile error — `options.layout` and `layout_weights_for` do not exist.

- [ ] **Step 3: Implement**

In `src-tauri/src/cli_analyze.rs`, add the field and the helper (`CliAnalyzeOptions` currently derives `Copy`; drop `Copy` from that derive since it now owns a `String`, and fix the two or three call sites the compiler points at):

```rust
/// Weights for an explicit `--layout`, or an error naming the mismatch.
pub fn layout_weights_for(layout_id: &str, channels: usize) -> Result<Vec<f64>, String> {
  let roles = crate::dsp::channel_layouts::roles_for_layout(layout_id)
    .ok_or_else(|| format!("unknown layout: {layout_id}"))?;
  if roles.len() != channels {
    return Err(format!(
      "layout {layout_id} has {} channels, the source has {channels}",
      roles.len()
    ));
  }
  crate::dsp::channel_layouts::weights_for_roles(roles)
    .ok_or_else(|| format!("layout {layout_id} has an unknown role"))
}
```

Feed the returned weights into the summary meter where the analysis is constructed, and set `loudness_layout` / `loudness_layout_known` from the layout id. On `Err`, return the existing CLI error report path so the process exits non-zero — do not fall back to auto detection.

In `src-tauri/src/cli_main.rs`, add `--layout <id>` to `parse_analyze_option_flag` and to the capture argument parser, validating the id against `roles_for_layout` at parse time, and add it to both usage strings.

Mirror the same field, helper call and flag in `src-tauri/src/cli_capture.rs`.

- [ ] **Step 4: Run them to verify they pass**

Run: `npm run rust:test`
Expected: PASS.

- [ ] **Step 5: Document the flag**

In `docs/cli.md`, add `--layout <id>` to the `analyze` and `capture` option tables: "Interpret the source with this channel layout instead of detecting it by channel count. Ids: `mono`, `stereo`, `lcr`, `quad`, `5.0`, `5.1`, `7.0`, `7.1`, `5.1.2`, `5.1.4`, `7.1.2`, `7.1.4`, `9.1.6`. A channel count mismatch is an error, never a fallback."

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/cli_analyze.rs src-tauri/src/cli_capture.rs src-tauri/src/cli_main.rs docs/cli.md
git commit -m "feat(cli): let analyze and capture take an explicit channel layout"
```

---

## Task 12: Documentation

**Files:**
- Modify: `docs/prd.md:226`
- Modify: `docs/architecture.md` §5
- Modify: `docs/agent-control/measurements.md`

- [ ] **Step 1: Update the PRD**

Replace the A.3 entry "手动布局预设缺口" with a delivered note: the manual layout selection ships in Settings (Channels · Layout), over Agent Control (`settings.channelLabels.layout`) and on the CLI (`--layout`), covering mono through 9.1.6. Keep the roadmap entry for object / scene-based audio (C) untouched. In §5's multichannel section, record that layouts above 8 channels are never detected by channel count, and that an unknown layout shows both the `Ch 1–2` marker and the footer prompt.

- [ ] **Step 2: Update the architecture doc**

In `docs/architecture.md` §5, state that `shared/channel-layouts.json` is the single source for roles, weights and layout order, embedded by Rust and imported by the frontend; that the frontend sends role lists and Rust derives weights and the reported layout; and that channel order is WAVE / ffmpeg order, with SMPTE bed order corrected through the per-channel role editor.

- [ ] **Step 3: Update the measurements doc**

In `docs/agent-control/measurements.md`, extend the `loudnessLayout` value list with `5.1.2`, `5.1.4`, `7.1.2`, `7.1.4` and `9.1.6`, keep the note that the set is open, and say that `custom` now means a role list that matches no layout.

- [ ] **Step 4: Commit**

```bash
git add docs/prd.md docs/architecture.md docs/agent-control/measurements.md
git commit -m "docs: record manual channel layout selection and the new layout values"
```

---

## Task 13: Full verification

- [ ] **Step 1: Run the merge gate**

Run: `npm run check`
Expected: exit 0. Fix anything it reports; do not loosen an assertion to make it pass.

- [ ] **Step 2: Run the capture smoke test**

Run: `npm run smoke:capture`
Expected: exit 0, with the stereo VB-Cable baseline unchanged from A's recorded values (Integrated ≈ −22.03 LUFS). If it exits 2, rebuild the harness binary first: `cargo build --manifest-path src-tauri/Cargo.toml --profile harness --features capture-harness`.

- [ ] **Step 3: Manual check in the development app**

Run: `npm run desktop`, then in a second terminal `npm run desktop:control -- inspect --json`.

- File mode with a 12-channel WAV: before selecting a layout, the summary reports `loudnessLayout: "unknown"`, `loudnessLayoutKnown: false`, the `Ch 1–2` marker shows and the footer reads "Channel layout unknown · Set in Settings". After choosing 7.1.4 in Settings, both disappear, `inspect` reports `loudnessLayout: "7.1.4"`, and Integrated changes.
- Edit one channel role: `inspect` reports `custom`, and Settings shows `Custom`.
- `plvs-cli analyze <12ch.wav> --json --layout 7.1.4` reports `7.1.4`; `--layout 5.1` exits non-zero naming the mismatch.

- [ ] **Step 4: Record the verification in the spec**

Append a `## Verification` section to `docs/superpowers/specs/2026-09-16-immersive-channel-layouts-design.md` with the commands run, their results, and anything left unverified — following the format A used.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-09-16-immersive-channel-layouts-design.md
git commit -m "docs(spec): record immersive channel layout verification"
```

- [ ] **Step 6: Remind the user**

After the capture-layer work, remind the user to run `npm run soak:capture` (4 hours by default). Judge drift against the retained baseline band of 0.0028–0.0034 dB, not the 0.01 limit.

---

## Notes for the implementer

- **Do not add SMPTE-order presets.** The spec's Risks section explains why; the per-channel role editor is the escape hatch.
- **`shared/` is the cross-language source directory.** Its files are consumed by both Vitest and cargo tests; changing one without the other fails a test, which is the point.
- **The audio callback must not allocate.** Weights and the layout id are derived when the command arrives, never per chunk.
- **Never hand-edit `docs/agent-control/generated/`** — run `npm run docs:agent-control`.
