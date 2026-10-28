# ADR 0041: Retain Native Tray Menu Handles

**Status:** Accepted

**Date:** 2026-10-28

## Context

Tray actions sometimes dismissed the menu without executing until a second selection. PLVS rebuilt
the attached menu for visibility, transport, Preset, update and workbench inventory changes. Source
selection alone was synchronized in place, leaving the same failure mechanism in other actions.

In the pinned Windows `tray-icon` implementation, `set_menu` detaches the previous menu subclass
from the hidden Tray window and attaches the replacement. A popup already tracking a selection
still belongs to the old menu. Replacing its command handler while it is open can therefore lose
that selection. Background inventory refreshes make this possible without another user action.

## Decision

Create and attach one native menu for each Tray lifetime. Reconcile keyed item definitions against
existing native handles: update text, enabled and checked state in place, and insert, move or remove
children only when membership changes. Keep surviving items and their action channels. Their
callbacks dispatch to the latest business actions and state rather than captured menu snapshots.

Serialize native updates, close resources for removed items, and release the menu resources when
the Tray is disposed. Workbench, source and preset IDs provide stable item identities across
updates, including transitions between one and several workbenches.

## Alternatives

Rebuilding the entire menu is simpler, but it rebinds the native command handler and introduces
the failure above. Limiting rebuilds to fewer state fields leaves other asynchronous triggers.
Delaying replacement until a guessed timeout is also insufficient: menu tracking has no fixed
duration and the JavaScript Tray API does not expose a portable popup-closed event.

## Consequences

The frontend owns a small native menu reconciler. Tests retain the original native menu and action
handles across Show / Hide, background workbench visibility changes, source inventory changes and
update state changes, and verify that the first selection still invokes the intended action.
The native menu layout and business guards remain owned by their existing controllers.
