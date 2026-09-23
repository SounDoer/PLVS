# ADR 0008: Multi-Process Workbenches with a Shared Library

**Status:** Accepted

**Date:** 2026-09-23

## Context

PLVS users need independent metering workbenches for different application or device Sources. The
audio engine, window geometry, Dock posture and active Preset/Profile/Theme snapshot are naturally
owned by one workbench, while saved Library items and identity-wide preferences must remain
consistent and discoverable everywhere. A single shared settings JSON file cannot provide both
properties safely when several processes write concurrently.

## Decision

Each workbench runs in its own Tauri process and owns one internal Workspace. Workspace creation and
naming remain implicit: the visible name is derived from the selected Source. Processes share a
transactional SQLite Library and global preferences, while each Workspace has single-writer
storage for Source, layout, active snapshots, window and Dock state.

One elected coordinator owns identity-wide operating-system resources: Tray, global shortcut,
Open at Login and updater lifecycle. A disk-backed live registry and authenticated per-instance
Agent Control endpoints allow the coordinator and `plvs-cli` to address a specific workbench.
Coordinator loss does not stop capture; a surviving process can acquire a fenced next generation.

Identity-wide destructive operations use a prepare/commit protocol. Every workbench must report no
blocking editor, stop capture and flush persistence before an update, complete configuration
replacement or full-app quit may commit. Timeout or refusal aborts the operation rather than
guessing that a peer is safe.

## Consequences

- A process crash is isolated to one workbench, and its Workspace remains recoverable.
- Shared Library writes require revisions and explicit conflict handling; last-writer-wins is not
  an acceptable fallback.
- Native singleton resources must never be registered independently by every process.
- Ordinary launches allocate implicit Workspaces; the product does not expose profile naming or a
  profile manager.
- Development, Preview and Release retain separate application identities and discovery roots.
- Supporting several sessions in one process remains a possible future redesign, but is not the
  compatibility model for this implementation.

