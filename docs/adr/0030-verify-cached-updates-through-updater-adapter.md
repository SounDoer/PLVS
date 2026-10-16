# 0030: Verify cached updates through a narrow updater adapter

Date: 2026-10-16
Status: Accepted

## Context

Deferred update installation must work after process exit and without another network request.
Tauri updater 2.13.2 exposes separate download and install operations, but its JavaScript resource
is memory-backed. The Rust Update installation context is private and can only be obtained through
a network check. Its install operation assumes bytes were verified during download in that process.

## Decision

Vendor the pinned updater with a narrowly documented extension that reconstructs an Update from a
cached manifest using the current application's context. Share the existing platform selection and
version comparison rather than duplicating them in PLVS. Add explicit cached-byte verification and
a verified-install entry point that checks the package immediately before native installation.

The current application's configuration supplies the trusted signing key and installation context.
Cached metadata never authorizes an arbitrary installation path. The application still owns durable
storage, cancellation, installation coordination, and explicit user confirmation.

## Consequences

PLVS avoids maintaining separate macOS bundle replacement and Windows package interpretation code
just to recover an Update after restart. It also avoids a loopback server masquerading as the remote
release endpoint. A cache checksum is useful for detecting corruption, but does not authenticate an
installer; cached installation must use signature verification even if download verified it earlier.

Vendoring creates a dependency-maintenance obligation. Keep the upstream license files, version,
patch description, and dedicated offline-reconstruction tests. Review upstream changes on upgrades
and remove the adapter when an equivalent supported API exists. This decision does not establish
Windows handoff safety or promise automatic rollback; those require application-level validation.
