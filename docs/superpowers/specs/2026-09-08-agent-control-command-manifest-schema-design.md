# Agent Control Command Manifest and Schema Export — Design

**Date:** 2026-09-08
**Status:** Proposed design contract

## Summary

Add one repository-owned, machine-readable command manifest for the public PLVS CLI and expose its
safe public projection through offline `schema list` and `schema get` commands. Use the manifest to
render root/family help, derive the static Agent Control method catalog, generate the command
reference, and enforce bidirectional coverage between CLI parsing, wire normalization,
capabilities, and frontend dispatch.

This work consolidates duplicated command facts without replacing the existing handwritten CLI
parsers or frontend semantic validators. Those code paths contain mature command-specific safety
rules and remain authoritative for execution. The manifest is authoritative for catalog metadata:
command identity, CLI path and usage, operation class, runtime dependency, wire method, revision
and dry-run policy, output-file policy, positionals, options, and the structural shape of top-level
wire parameters.

The public schema is a small versioned PLVS format, consistent with the existing Agent Control
`describe` responses. It is not advertised as complete JSON Schema and does not attempt to publish
every dynamic result shape in this first version.

## Why now

Agent Control now exposes close to ninety wire methods. The same public surface is currently
represented in several independent places:

- `COMMAND_NAMES`, command-specific parsers, `ControlCommand`, `command_name`, and manually composed
  help in Rust;
- the frontend `METHODS` array plus separate Device and Visual method arrays;
- request normalization branches and frontend bridge dispatch;
- public Markdown and generated control references;
- family-specific contract tests.

The current tests catch many omissions but do not form one closed inventory. A recent example was
that `config` and `visual` parsed and executed correctly while root help omitted both families.
Continuing to add commands to the current structure increases the chance and cost of similar drift.

The original Agent Control design deferred full schema publication until a real consumer existed.
That condition is now met: agents need preflight command discovery, generated completions need exact
option metadata, and future SDK/MCP adapters need a stable semantic catalog rather than another
handwritten command tree.

## Goals

- Maintain one cross-language catalog of every public CLI leaf command.
- Make command discovery and input shape available without starting PLVS.
- Generate root and family usage lines from the same entries the schema commands expose.
- Remove the frontend's independent base method inventory and derive potential wire methods from the
  manifest.
- Preserve dynamic capability filtering in the running app.
- Preserve all existing command names, accepted arguments, wire methods, JSON envelopes, exit codes,
  revision rules, dry-run behavior, and business semantics.
- Detect missing parser, request mapping, normalizer, advertised method, or bridge dispatch coverage
  in tests.
- Give future help, completion, documentation, SDK, and MCP work a stable input.

## Non-goals

- Rewriting the CLI around a generic parser or adding a parser dependency.
- Replacing command-specific frontend normalization with generic schema validation.
- Publishing internal Rust/React types or raw Tauri commands.
- Publishing exhaustive success/error result schemas in V1.
- Replacing runtime `app.capabilities`, `panel describe`, `settings describe`, `device list`, or
  `visual describe`.
- Adding human-readable output, shell completion generation, MCP, batch execution, File report
  export, or macOS Agent Control transport in this slice.
- Renaming commands, options, wire methods, fields, or error reasons.
- Expanding Agent Control permissions or allowing execution through the schema surface.
- Adding recording, audio-source, measurement, or product functionality.

## Source form and ownership

Create a neutral JSON source file consumed by both JavaScript and Rust:

```text
src/agentControl/commandManifest.json
```

This file is code-owned declarative data, not documentation, generated output, user configuration,
or a supported file-import format. It is edited only when the public CLI surface changes.

The root object is:

```json
{
  "manifestVersion": 1,
  "commands": []
}
```

JavaScript imports it normally. Rust embeds the same bytes with `include_str!`, validates and
deserializes them once, and never searches the filesystem at runtime. `build.rs` marks the file as a
Cargo rebuild input and rejects malformed JSON early; semantic validation remains covered by Rust
and Vitest tests.

### What the manifest owns

For each public leaf command, the manifest owns:

- stable schema ID;
- CLI token path and canonical usage line;
- family and concise summary;
- offline versus running-app execution;
- query, mutation, action, or wait classification;
- wire method when the command talks to a running app;
- optional runtime feature gate;
- JSON requirement;
- expected-revision policy;
- dry-run support;
- local output-file policy;
- positional and option metadata;
- top-level wire parameter shape and references to deeper documents.

### What remains owned by executable code

- Rust parsers decide whether a concrete argv is accepted and construct `ControlCommand` values.
- Rust request mapping reads files/stdin, canonicalizes paths, converts CLI spelling to wire spelling,
  and constructs JSON-RPC requests.
- Frontend normalizers enforce exact fields, types, ranges, dynamic constraints, and stable errors.
- The React bridge owns business dispatch, safety guards, native side effects, revision changes, and
  persistence settlement.
- Runtime `describe` builders own schemas that depend on current panels, devices, profiles,
  topology, platform, or application state.

The manifest must never be used as evidence that an operation is safe to execute. It describes the
public contract; the existing semantic owner still enforces it.

## Command entry model

An illustrative entry is:

```json
{
  "id": "visual.recording.start",
  "family": "visual",
  "path": ["visual", "recording", "start"],
  "usage": "plvs-cli visual recording start --target <main|workspace> [--audio <none|measured-source>] [--cursor <none|visible>] [--fps <15|30|60>] [--max-duration-seconds <1..1800>] [--expected-revision <n>] --json",
  "summary": "Start one bounded PLVS surface recording.",
  "execution": "runningApp",
  "operation": "action",
  "wireMethod": "visual.recording.start",
  "featureGate": "visual.recording",
  "json": "required",
  "expectedRevision": "optional",
  "dryRun": false,
  "outputFile": "none",
  "positionals": [],
  "options": [
    {
      "name": "--target",
      "mapsTo": "target.kind",
      "required": true,
      "value": { "type": "string", "enum": ["main", "workspace"] }
    },
    {
      "name": "--cursor",
      "mapsTo": "cursor",
      "required": false,
      "value": { "type": "string", "enum": ["none", "visible"], "default": "none" }
    }
  ],
  "wireParams": {
    "type": "object",
    "additionalProperties": false,
    "required": ["target"],
    "properties": {
      "target": { "schemaRef": "visual.recordingTarget" },
      "audio": { "type": "string", "enum": ["none", "measuredSource"] },
      "cursor": { "type": "string", "enum": ["none", "visible"], "default": "none" },
      "fps": { "type": "integer", "enum": [15, 30, 60], "default": 30 },
      "maxDurationSeconds": { "type": "integer", "minimum": 1, "maximum": 1800 },
      "expectedRevision": { "schemaRef": "agentControl.revision" }
    }
  }
}
```

The final manifest contains complete metadata for every existing public command. The example above
does not freeze field ordering beyond the documented deterministic output rules.

### Stable command IDs

- Running-app commands use their wire method as `id`, for example `workspace.applyLayout` and
  `loudnessProfile.select`.
- Offline commands use a namespaced CLI identity, initially `doctor`, `schema.list`, and
  `schema.get`.
- `--help`, `help`, and `--version` are parser meta operations, not leaf command entries.
- Internal `--harness` commands never appear.

IDs are unique and case-sensitive. CLI paths use the existing kebab-case spellings; wire methods
retain existing camelCase segments.

### Referenced document schemas

The manifest describes top-level arguments but does not duplicate large versioned documents or
dynamic control schemas. An option/parameter can use `schemaRef`, such as:

- `workspace.layout`;
- `theme.document.v2`;
- `loudnessProfile.document`;
- `configurationProfile.v1`;
- `panel.patch.runtime`.

The schema result includes a `discovery` field where a runtime command supplies the referenced
shape, for example `panel.describe`. References without a runtime describe command point to the
existing public document contract. V1 does not add a separate schema registry for expanding every
reference.

## Public commands

Add two offline commands:

```powershell
plvs-cli schema list --json
plvs-cli schema get <command-id> --json
```

They execute inside the CLI host before Agent Control discovery. They therefore work when:

- PLVS is closed;
- Agent Control is disabled;
- the running app is a different version;
- the build is on a platform without Agent Control transport.

They reject `--out`, stdin documents, expected revision, dry-run, and unknown options in V1.

### `schema list`

The successful V1 result is compact:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {
    "manifestVersion": 1,
    "commands": [
      {
        "id": "visual.recording.start",
        "family": "visual",
        "path": ["visual", "recording", "start"],
        "summary": "Start one bounded PLVS surface recording.",
        "execution": "runningApp",
        "operation": "action",
        "wireMethod": "visual.recording.start",
        "featureGate": "visual.recording"
      }
    ]
  }
}
```

Fields whose value is not applicable, such as `wireMethod` for `doctor`, are omitted rather than
serialized as `null`.

### `schema get`

The successful result returns the full public projection of one manifest entry:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {
    "manifestVersion": 1,
    "command": {
      "id": "visual.recording.start",
      "family": "visual",
      "path": ["visual", "recording", "start"],
      "usage": "plvs-cli visual recording start ... --json",
      "summary": "Start one bounded PLVS surface recording.",
      "execution": "runningApp",
      "operation": "action",
      "wireMethod": "visual.recording.start",
      "featureGate": "visual.recording",
      "json": "required",
      "expectedRevision": "optional",
      "dryRun": false,
      "outputFile": "none",
      "positionals": [],
      "options": [],
      "wireParams": {}
    }
  }
}
```

The real response contains the complete option and parameter objects; the abbreviated example only
shows the envelope.

Unknown IDs fail locally with JSON error code `invalidArguments` and CLI exit code 3. The error may
include bounded suggestions derived from exact manifest IDs, but never silently chooses a command.

## Schema vocabulary

V1 deliberately reuses the small PLVS schema vocabulary already used by runtime describe commands:

- `type`: `boolean`, `integer`, `number`, `string`, `array`, or `object`;
- `enum`, `default`, `minimum`, `maximum`, and `required`;
- `properties`, `items`, and `additionalProperties`;
- `schemaRef` for a deeper or dynamic public document;
- CLI-only `name`, `mapsTo`, and `value` metadata for positionals/options.

This is not declared to implement a JSON Schema draft. Unknown manifest fields are rejected by both
loaders so misspelled catalog metadata cannot silently disappear.

`schemaVersion` continues to version the outer CLI envelope. `manifestVersion` versions this
catalog vocabulary. Additive command entries, enum metadata, descriptions, or optional fields do
not require a manifest-version change. A breaking interpretation change does.

## Help generation

The current Rust help is assembled from one base string followed by multiple `replacen()` calls.
Replace that composition with deterministic rendering from manifest entries.

- Root help lists offline commands and every public family exactly once.
- Family help selects entries by `family` and renders their canonical usage lines in manifest order.
- Help prose and exit-code explanations remain small handwritten templates.
- `schema` receives its own help topic.
- Existing usage spelling and required/optional bracket semantics remain unchanged.

The manifest order is stable presentation order. Schema output preserves it; callers must not infer
execution precedence from it.

## Capabilities and runtime describe relationship

The manifest describes commands the installed CLI knows how to issue. `app.capabilities` describes
wire methods the running application currently accepts. They may legitimately differ when the CLI
and app versions differ.

The frontend derives its potential wire method catalog from manifest entries rather than a separate
`METHODS` array. It then applies current runtime feature gates before building capabilities:

- an entry without `featureGate` is part of the base running-app method catalog;
- `visual.screenshot` requires `features.visual.screenshot`;
- Visual recording lifecycle methods require `features.visual.recording`;
- `visual.describe` remains available when the platform can report Visual support even if capture
  itself is unavailable, matching the existing behavior.

The frontend does not advertise offline commands. The CLI does not replace the running app's method
list with its own manifest during capability adaptation.

Agents use the three layers in order:

```text
schema       static syntax and structural input contract of the installed CLI
capabilities methods and feature availability of the running app
describe     current dynamic resources, choices, limits, and effective state
```

## Coverage and drift prevention

The implementation adds closed, bidirectional checks:

1. Every public CLI leaf parsed by Rust has exactly one manifest entry.
2. Every running-app manifest entry has exactly one wire method mapping.
3. Every manifest wire method has a frontend normalizer and is present in the potential capability
   catalog.
4. Every advertised method has a manifest entry and reaches a bridge path rather than
   `unsupportedMethod`.
5. Every feature-gated method is absent/present under the documented capability combinations.
6. Every family in root help has at least one manifest entry, and every entry appears in its family
   help.
7. Generated command-reference output is a snapshot of the manifest projection.
8. Internal harness commands, raw Tauri functions, schema commands, and `doctor` never appear in
   `app.capabilities.methods`.

Command-specific tests remain necessary. A catalog entry cannot prove that a complex parser or
business operation is correct.

## Generated documentation

Add a generated reference page:

```text
docs/agent-control/generated/commands.md
```

It contains command ID, CLI path, execution/operation class, revision and dry-run policy, output
policy, canonical usage, and option/positional tables. It is generated through the existing
`npm run docs:agent-control` workflow and must never be hand-edited.

Handwritten pages continue to explain workflows, safety, errors, and semantic behavior. They link
to the generated catalog instead of duplicating the full command inventory.

## Compatibility

- Existing argv parsing and JSON-RPC requests remain byte-for-byte compatible for canonical inputs.
- Existing help wording may change only where deterministic catalog rendering removes omissions or
  inconsistent ordering; usage syntax must not change.
- Existing `app.capabilities` result meaning remains unchanged.
- `schema` is additive and does not require the desktop app or a protocol-version bump.
- Old CLI binaries continue to control compatible newer apps through the existing capability
  handshake; new CLIs can inspect their own static schema even when connected to an older app.
- The manifest contains no app identity, discovery token, paths, device names, current state, or
  user data.

## Failure behavior

- Malformed embedded manifest data is a build/test failure. Runtime loaders return a bounded local
  system failure rather than partially rendering a catalog.
- Duplicate IDs, duplicate CLI paths, duplicate wire methods, missing families, unknown schema
  vocabulary, and invalid policy combinations fail validation.
- `schema get` with an unknown ID is `invalidArguments`, exit 3.
- Broken stdout or serialization is a runtime/system failure, exit 1.
- Schema queries do not contact a running app and therefore never return app-not-running,
  authentication, revision, or frontend errors.

## Explicit cleanup included in scope

- Remove `COMMAND_NAMES` as an independently maintained family list.
- Remove the base-help-plus-`replacen()` assembly.
- Remove the frontend base `METHODS` array and derive it from manifest wire entries.
- Replace Device/Visual method arrays where they exist only for cataloging; retain domain-specific
  classifiers where executable logic needs them, deriving their membership from manifest metadata
  when practical.
- Replace documentation tests that merely search for isolated command strings with manifest-driven
  completeness checks, while preserving semantic prose assertions.

This cleanup must remain behavior-preserving. It does not authorize rewriting the command enum,
large parser branches, request construction, normalizers, or bridge business functions merely for
style.

## Acceptance criteria

- `schema list/get` work with PLVS closed and Agent Control disabled.
- The manifest covers every public CLI leaf and excludes every internal harness command.
- Root/family help is rendered from the manifest and lists every command exactly once.
- Existing CLI parser/request golden tests remain green without changed public requests.
- Frontend capabilities preserve the current dynamic Visual availability behavior.
- Bidirectional catalog/parser/normalizer/capability/dispatch guards fail on an intentionally
  missing or orphaned entry.
- The generated command reference matches the manifest.
- No current command, option, default, output envelope, exit code, revision rule, or safety guard
  changes.
- `npm run check` passes on Windows and CI remains green on Windows and macOS compilation jobs.

## Deferred follow-ups

Once this contract is stable, separate designs may consume it for:

- PowerShell, bash, and zsh completion generation;
- optional human-readable query output;
- typed SDK generation;
- an MCP adapter over the existing semantic API;
- declarative batch validation.

Those features are not silently included in this implementation.
