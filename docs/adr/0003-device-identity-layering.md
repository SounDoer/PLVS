# ADR 0003: Keep device identity split across DTO / id algebra / cpal enumeration

## Status

Accepted

## Context

Audio device identity in `src-tauri/src/audio/` lives in three files:

- **`device.rs`** (~22 lines) — the `DeviceInfo` serde DTO, **shared with the frontend** (re-exported as `audio::DeviceInfo`).
- **`device_id.rs`** (~181 lines) — the **pure id algebra**: stable `lb-*` / `cap-*` allocation (SHA-256 of the endpoint name + collision nonce), v1 legacy digests, `is_stable_*`, and `parse_legacy_*`. It depends only on `sha2` — **it does not touch cpal**, and carries its own `#[cfg(test)]` unit tests.
- **`device_enum.rs`** (~330 lines) — the **cpal-bound enumeration**: collecting/sorting devices, building labels, and resolving any id (stable, legacy index, or `"default"`) to a `cpal::Device`. Depends on `device.rs`, `device_id.rs`, **and cpal**.

The dependency direction is one-way and clean: `device_enum` → (`device`, `device_id`); `device_id` is a leaf.

A whole-repo architecture review (2026-06) flagged "device identity is split across three files" as fragmentation and proposed merging them into a single `audio/device/` module so callers import from one path.

## Decision

**Keep the three-way split.** The grouping is by concern, not by noun:

1. **`device_id.rs` must stay cpal-free.** The stable-id hashing and v1/v2 legacy resolution is the gnarly, regression-prone part. Keeping it free of cpal is what lets it be unit-tested **without audio hardware or a host** — and it already is. This is a real internal seam, not an accident of file count.
2. **`device.rs` is a frontend-shared DTO.** Being small is not a reason to fold it into a large cpal module; its smallness reflects a single, stable responsibility.
3. **`device_enum.rs`** is the only piece that needs cpal, and it composes the other two.

## Consequences

- Callers (`cpal_backend`, `macos`, `ipc/commands`) may import from up to three paths under `audio::`. This is acceptable Rust module usage, not friction worth a refactor.
- The id algebra keeps its hardware-free test seam; new id schemes or legacy migrations are testable in isolation.
- Future architecture reviews should **not** re-suggest merging these three. The split is deliberate; "three files named device" is good layering here, not fragmentation.

## Alternatives considered

- **Merge into one `audio/device/` module** — rejected. The merge target (`device_enum`) is cpal-bound, so merging would entangle the cpal-free, hardware-free-testable id algebra with cpal I/O, losing the internal seam that makes the id logic depth-y and testable. It trades a clean three-concern layering for a single shallow file.
