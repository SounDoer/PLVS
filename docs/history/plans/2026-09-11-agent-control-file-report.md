# Agent Control File Analysis Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `plvs-cli transport file report <session-id> --json [--out <file>]`, a running-app
query that returns the GUI's `fileAnalysis` v1 report for a completed FILE session.

**Architecture:** The frontend bridge looks the session up in the public Transport snapshot and
calls the existing `buildFileAnalysisReport`. Rust parses the command, sends `{ sessionId }`, and
reuses the library/config export `--out` move. The command manifest entry drives capabilities,
schema, completions, help, and generated docs.

**Tech Stack:** React 19 + Vitest (jsdom) for the bridge, Rust for `plvs-cli`, JSON command
manifest shared by both.

**Spec:** [`../specs/2026-09-11-agent-control-file-report-design.md`](../specs/2026-09-11-agent-control-file-report-design.md)

---

## File map

| File                                              | Responsibility in this change                   |
| ------------------------------------------------- | ----------------------------------------------- |
| `src/agentControl/protocol.js`                    | Validate `transport.file.report` params         |
| `src/agentControl/protocol.test.js`               | Param validation tests                          |
| `src/agentControl/useAgentControlBridge.js`       | Handle the method: lookup, refusals, report     |
| `src/agentControl/useAgentControlBridge.test.jsx` | Bridge behavior tests                           |
| `src-tauri/src/cli_control.rs`                    | Parse, request, `--out` move, exit class, tests |
| `src/agentControl/commandManifest.json`           | Public command entry                            |
| `src/agentControl/appSnapshot.test.js`            | Capabilities method list                        |
| `docs/agent-control/generated/commands.md`        | Regenerated, never hand-edited                  |
| `docs/agent-control/transport.md`, `docs/cli.md`  | Public contract                                 |
| `docs/working/agent-control-cli-roadmap.md`       | Mark the item complete                          |
| `scripts/cliDocumentationContract.test.js`        | Documentation contract                          |

Task order keeps every commit green: the manifest entry is added only after both the bridge and the
Rust parser handle the method, because manifest-driven tests on both sides exercise every entry.

Per the repository rule, run the full `npm run check` before every commit.

---

### Task 1: Protocol validation

**Files:**

- Modify: `src/agentControl/protocol.js` (insert before `const transportCommands = new Set([`)
- Test: `src/agentControl/protocol.test.js`

- [ ] **Step 1: Write the failing tests**

Append inside the top-level `describe` of `src/agentControl/protocol.test.js`:

```js
it("normalizes transport.file.report to its session id", () => {
  expect(
    normalizeAgentControlRequest(request("transport.file.report", { sessionId: "file-1" }))
  ).toEqual({
    ok: true,
    request: {
      id: "req-1",
      method: "transport.file.report",
      params: { sessionId: "file-1" },
    },
  });
});

it.each([
  [{}, "$.params.sessionId"],
  [{ sessionId: "" }, "$.params.sessionId"],
  [{ sessionId: "  " }, "$.params.sessionId"],
  [{ sessionId: 7 }, "$.params.sessionId"],
  [{ sessionId: "file-1", expectedRevision: 0 }, "$.params.expectedRevision"],
  [{ sessionId: "file-1", dryRun: true }, "$.params.dryRun"],
])("rejects transport.file.report params %j", (params, path) => {
  expect(normalizeAgentControlRequest(request("transport.file.report", params))).toMatchObject({
    ok: false,
    error: { reason: "invalidParams", path, code: -32602 },
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/agentControl/protocol.test.js -t "transport.file.report"`
Expected: FAIL — the method is unknown, so the result is `methodNotFound`, not the expected shape.

- [ ] **Step 3: Implement the validation**

In `src/agentControl/protocol.js`, insert immediately before `const transportCommands = new Set([`:

```js
if (input.method === "transport.file.report") {
  const field = unknownField(input.params, new Set(["sessionId"]));
  if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
  if (typeof input.params.sessionId !== "string" || input.params.sessionId.trim() === "") {
    return invalidParams("$.params.sessionId", "sessionId must be a non-empty string.");
  }
  return {
    ok: true,
    request: {
      id: input.id,
      method: input.method,
      params: { sessionId: input.params.sessionId },
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/agentControl/protocol.test.js`
Expected: PASS, including the existing cases.

- [ ] **Step 5: Commit**

```bash
npm run check
git add src/agentControl/protocol.js src/agentControl/protocol.test.js
git commit -m "feat(agent-control): validate file report requests" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Bridge handler

**Files:**

- Modify: `src/agentControl/useAgentControlBridge.js` (imports; handler after the
  `transport.inspect` branch, around line 1790)
- Test: `src/agentControl/useAgentControlBridge.test.jsx`

The bridge receives the public Transport snapshot (`buildTransportSnapshot` in
`src/agentControl/transportControl.js`). Its sessions carry the builder's inputs, except that the
probe metadata is named `probe` rather than `metadata`, and `state` is the public lifecycle
(`complete` is unchanged). The handler therefore passes `{ ...session, metadata: session.probe }`.

- [ ] **Step 1: Write the failing tests**

In `src/agentControl/useAgentControlBridge.test.jsx`, add the import next to the other `../lib`
imports:

```js
import { buildFileAnalysisReport } from "../lib/fileAnalysisReport.js";
```

Then add this `describe` block beside the other top-level `describe` blocks (for example right after
`describe("Device Control", ...)`):

```js
describe("File analysis report", () => {
  const completeSession = {
    id: "file-analysis-1757548800000-k3j9x2",
    path: "C:\\audio\\mix.wav",
    fileName: "mix.wav",
    state: "complete",
    progress: 1,
    probe: {
      path: "C:\\audio\\mix.wav",
      fileName: "mix.wav",
      container: "wav",
      durationMs: 12000,
      selectedTrack: {
        index: 0,
        codec: "pcm_s16le",
        sampleRateHz: 48000,
        channels: 2,
        language: null,
      },
    },
    summary: {
      durationMs: 12000,
      sampleRateHz: 48000,
      channels: 2,
      integratedLufs: -23.1,
      lra: 4.2,
      mMaxLufs: -18,
      stMaxLufs: -20.5,
      truePeakMaxDbtp: -1.2,
      samplePeakMaxLDb: -1.5,
      samplePeakMaxRDb: -1.75,
      dialogueIntegrated: null,
      dialogueLra: 0,
    },
    createdAt: 1757548790000,
    analyzedAt: 1757548800000,
    decodedFrames: 576000,
    historyTruncated: false,
    historyCoveredMs: null,
    analysisSettings: { dialogue: { enabled: false } },
    error: null,
  };
  const reportTransport = (sessions) => ({
    ...transport,
    source: "file",
    files: { activeId: sessions[0]?.id ?? null, analyzingId: null, sessions },
  });

  it("returns the GUI export document for a completed session without changing state", async () => {
    const snapshot = reportTransport([completeSession]);
    mount({ agentTransport: snapshot });
    await waitUntilReady();

    const response = await send(
      request("transport.file.report", { sessionId: completeSession.id }, "file-report")
    );

    expect(response.result).toEqual({
      revision: 0,
      sessionId: completeSession.id,
      report: buildFileAnalysisReport(
        { ...completeSession, metadata: completeSession.probe },
        { appVersion: runtime.appVersion, exportedAt: response.result.report.exportedAt }
      ),
    });
    expect(response.result.report).toMatchObject({
      schemaVersion: 1,
      reportType: "fileAnalysis",
      app: { version: runtime.appVersion },
      source: { fileName: "mix.wav", container: "wav" },
      summary: { integratedLufs: -23.1, samplePeakMaxDb: -1.5 },
    });
    const after = await send(request("transport.inspect", {}, "file-report-after"));
    expect(after.result).toEqual({ revision: 0, ...snapshot });
  });

  it("reports an unknown session as fileSessionNotFound", async () => {
    mount({ agentTransport: reportTransport([completeSession]) });
    await waitUntilReady();

    const response = await send(
      request("transport.file.report", { sessionId: "missing" }, "file-report-missing")
    );

    expect(response.error).toMatchObject({
      code: -32080,
      data: { reason: "fileSessionNotFound", details: { sessionId: "missing" } },
    });
  });

  it.each(["probing", "analyzing", "stopped", "error"])(
    "refuses a %s session with fileAnalysisNotComplete",
    async (state) => {
      const session = { ...completeSession, state };
      mount({ agentTransport: reportTransport([session]) });
      await waitUntilReady();

      const response = await send(
        request("transport.file.report", { sessionId: session.id }, `file-report-${state}`)
      );

      expect(response.error).toMatchObject({
        code: -32085,
        data: {
          reason: "fileAnalysisNotComplete",
          details: { sessionId: session.id, state },
        },
      });
      const after = await send(request("transport.inspect", {}, `file-report-${state}-after`));
      expect(after.result.revision).toBe(0);
    }
  );
});
```

If the existing error mapping nests `details` differently from `data.details`, inspect one existing
failure response in this file (for example a `targetUnavailable` case) and match that shape; do not
change the bridge's error mapping.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/agentControl/useAgentControlBridge.test.jsx -t "File analysis report"`
Expected: FAIL — the protocol accepts the method (Task 1), but the bridge has no handler, so the
response is not the expected result or error.

- [ ] **Step 3: Implement the handler**

In `src/agentControl/useAgentControlBridge.js`, add the import beside the other `../lib` imports:

```js
import { buildFileAnalysisReport } from "../lib/fileAnalysisReport.js";
```

Then insert directly after the `if (request.method === "transport.inspect") { ... }` block:

```js
if (request.method === "transport.file.report") {
  const session = transport.files.sessions.find(({ id }) => id === request.params.sessionId);
  if (!session) {
    throw semanticFailure(
      "fileSessionNotFound",
      "$.params.sessionId",
      "The FILE session was not found.",
      -32080,
      { sessionId: request.params.sessionId }
    );
  }
  if (session.state !== "complete") {
    throw semanticFailure(
      "fileAnalysisNotComplete",
      "$.params.sessionId",
      "Only a completed FILE analysis can be reported.",
      -32085,
      { sessionId: session.id, state: session.state }
    );
  }
  return {
    requestId,
    result: {
      revision: controlRevisionRef.current,
      sessionId: session.id,
      // The public snapshot names the probe `probe`; the GUI builder reads `metadata`.
      report: buildFileAnalysisReport(
        { ...session, metadata: session.probe },
        { appVersion: String(runtime.appVersion) }
      ),
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/agentControl/useAgentControlBridge.test.jsx`
Expected: PASS, including the manifest catalog test (the method is not in the manifest yet, so the
catalog does not exercise it).

- [ ] **Step 5: Commit**

```bash
npm run check
git add src/agentControl/useAgentControlBridge.js src/agentControl/useAgentControlBridge.test.jsx
git commit -m "feat(agent-control): build file analysis reports in the bridge" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Rust CLI parsing, request, `--out`, and exit class

**Files:**

- Modify: `src-tauri/src/cli_control.rs`
  - `ControlCommand` enum (after `TransportInspect,` near line 195)
  - `parse_transport_args` (near line 1142) plus a new `parse_transport_report_args`
  - the transport usage string (near line 1185)
  - `application` exit-class table (near line 2408)
  - `command_name` (near line 2483)
  - `request_for_command` (near line 2534)
  - `finish_export` (near line 3252)
  - tests module

- [ ] **Step 1: Write the failing tests**

In the `tests` module of `src-tauri/src/cli_control.rs`, add `("fileAnalysisNotComplete", None, 4),`
directly after `("fileAnalysisNotActive", None, 4),` in
`stable_app_error_classes_map_to_the_v1_exit_contract`, and add these tests after
`writing_a_configuration_replaces_it_with_the_path_it_was_written_to`:

```rust
  #[test]
  fn parses_transport_file_report_as_a_query_with_optional_out() {
    assert_eq!(
      parse_control_args(&args(&["transport", "file", "report", "file-1", "--json"])),
      Ok(ControlCommand::TransportReport {
        session_id: "file-1".to_string(),
        out: None,
      })
    );
    assert_eq!(
      parse_control_args(&args(&[
        "transport",
        "file",
        "report",
        "file-1",
        "--json",
        "--out",
        "mix-report.json"
      ])),
      Ok(ControlCommand::TransportReport {
        session_id: "file-1".to_string(),
        out: Some("mix-report.json".to_string()),
      })
    );
    let request = request_for_command(
      &ControlCommand::TransportReport {
        session_id: "file-1".to_string(),
        out: Some("mix-report.json".to_string()),
      },
      &mut Cursor::new([]),
    )
    .unwrap();
    assert_eq!(request.method, "transport.file.report");
    assert_eq!(request.params, serde_json::json!({ "sessionId": "file-1" }));

    for invalid in [
      args(&["transport", "file", "report", "--json"]),
      args(&["transport", "file", "report", "file-1"]),
      args(&["transport", "file", "report", "file-1", "--json", "--expected-revision", "3"]),
      args(&["transport", "file", "report", "file-1", "--json", "--dry-run"]),
      args(&["transport", "file", "report", "file-1", "--json", "--out"]),
      args(&["transport", "file", "report", "file-1", "extra", "--json"]),
    ] {
      assert!(parse_control_args(&invalid).is_err(), "parsed {invalid:?}");
    }
  }

  #[test]
  fn writing_a_file_report_replaces_it_with_the_path_it_was_written_to() {
    let report_result = || {
      serde_json::json!({
        "revision": 4,
        "sessionId": "file-1",
        "report": { "schemaVersion": 1, "reportType": "fileAnalysis" }
      })
    };
    let command = |out: String| ControlCommand::TransportReport {
      session_id: "file-1".to_string(),
      out: Some(out),
    };

    let path = std::env::temp_dir().join(format!("plvs-file-report-{}.json", std::process::id()));
    let mut written = ControlReport {
      schema_version: CLI_SCHEMA_VERSION,
      ok: true,
      result: Some(report_result()),
      error: None,
    };
    assert_eq!(
      finish_export(&command(path.to_string_lossy().into_owned()), &mut written, 0),
      0
    );
    let file: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(file["reportType"], "fileAnalysis");
    let result = written.result.unwrap();
    assert_eq!(result["out"], path.to_string_lossy().as_ref());
    assert!(result.get("report").is_none());
    assert_eq!(result["sessionId"], "file-1");
    fs::remove_file(path).unwrap();

    // A write failure exits 1 and leaves the report recoverable from stdout.
    let mut failed = ControlReport {
      schema_version: CLI_SCHEMA_VERSION,
      ok: true,
      result: Some(report_result()),
      error: None,
    };
    assert_eq!(finish_export(&command(unwritable_path()), &mut failed, 0), 1);
    assert_eq!(failed.result.unwrap()["report"]["reportType"], "fileAnalysis");
  }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib cli_control -- file_report stable_app_error_classes`
Expected: compile error — `ControlCommand::TransportReport` does not exist.

- [ ] **Step 3: Implement**

Add the enum variant after `TransportInspect,`:

```rust
  TransportReport {
    session_id: String,
    out: Option<String>,
  },
```

In `parse_transport_args`, directly after the `inspect` early return, add:

```rust
  if args.first().map(String::as_str) == Some("file")
    && args.get(1).map(String::as_str) == Some("report")
  {
    return parse_transport_report_args(&args[2..]);
  }
```

Add this function directly after `parse_transport_args`:

```rust
fn parse_transport_report_args(args: &[String]) -> Result<ControlCommand, String> {
  let session_id = match args.first() {
    Some(value) if !value.starts_with("--") && !value.trim().is_empty() => value.clone(),
    _ => {
      return Err(
        "Usage: plvs-cli transport file report <session-id> --json [--out <file>]".to_string(),
      )
    }
  };
  let mut json = false;
  let mut out = None;
  let mut index = 1;
  while index < args.len() {
    match args[index].as_str() {
      "--json" => {
        json = true;
        index += 1;
      }
      "--out" => {
        let value = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --out.".to_string())?;
        if value.starts_with("--") || value.is_empty() {
          return Err("Missing value for --out.".to_string());
        }
        out = Some(value.clone());
        index += 2;
      }
      value => return Err(format!("Unexpected transport file report argument: {value}")),
    }
  }
  if !json {
    return Err("The transport file report command requires --json.".to_string());
  }
  Ok(ControlCommand::TransportReport { session_id, out })
}
```

In the transport usage error string, change `...|file remove|file clear> ... --json` to
`...|file remove|file clear|file report> ... --json`.

In `ControlFailure::application`, add `| "fileAnalysisNotComplete"` directly after
`| "fileAnalysisNotActive"` in the exit-4 group.

In `command_name`, after `ControlCommand::TransportInspect => ...`:

```rust
    ControlCommand::TransportReport { .. } => "transport.file.report".to_string(),
```

In `request_for_command`, before `ControlCommand::TransportMutation { ... } =>`:

```rust
    ControlCommand::TransportReport { session_id, .. } => {
      serde_json::json!({ "sessionId": session_id })
    }
```

In `finish_export`, add an arm after the `ConfigExport` arm:

```rust
    ControlCommand::TransportReport {
      out: Some(path), ..
    } => (path, "report", "report"),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib cli_control`
Expected: PASS. The manifest-driven tests are unaffected because the manifest has no entry yet.

- [ ] **Step 5: Commit**

```bash
npm run check
git add src-tauri/src/cli_control.rs
git commit -m "feat(agent-control): parse transport file report in the CLI" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Publish the command in the manifest

**Files:**

- Modify: `src/agentControl/commandManifest.json` (insert after the `transport.file.clear` entry)
- Modify: `src/agentControl/appSnapshot.test.js` (capabilities method list)
- Modify: `src-tauri/src/cli_control.rs` (text-output rejection test)
- Regenerate: `docs/agent-control/generated/commands.md`

- [ ] **Step 1: Write the failing tests**

In `src/agentControl/appSnapshot.test.js`, add `"transport.file.report",` directly after
`"transport.file.clear",` in the expected `methods` list.

In the `tests` module of `src-tauri/src/cli_control.rs`, add:

```rust
  #[test]
  fn transport_file_report_rejects_text_output_because_it_can_write_a_file() {
    let error = parse_control_args(&args(&[
      "transport",
      "file",
      "report",
      "file-1",
      "--format",
      "text",
    ]))
    .unwrap_err();
    assert_eq!(error, "--format text is available only for read-oriented commands.");
  }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/agentControl/appSnapshot.test.js`
Expected: FAIL — `transport.file.report` is missing from the advertised methods.

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib cli_control -- transport_file_report_rejects_text_output`
Expected: FAIL — the error is "The transport.file.report command has no manifest entry."

- [ ] **Step 3: Add the manifest entry**

Insert this object into `commands` directly after the closing `},` of the `transport.file.clear`
entry:

```json
    {
      "id": "transport.file.report",
      "family": "transport",
      "path": ["transport", "file", "report"],
      "usage": "plvs-cli transport file report <session-id> --json [--out <file>]",
      "summary": "Export a completed file analysis report.",
      "execution": "runningApp",
      "operation": "query",
      "wireMethod": "transport.file.report",
      "json": "required",
      "expectedRevision": "none",
      "dryRun": false,
      "outputFile": "optional",
      "positionals": [
        {
          "name": "session-id",
          "mapsTo": "sessionId",
          "required": true,
          "value": {
            "type": "string"
          }
        }
      ],
      "options": [
        {
          "name": "--json",
          "required": true,
          "value": {
            "type": "boolean"
          }
        },
        {
          "name": "--out",
          "required": false,
          "value": {
            "type": "string"
          }
        }
      ],
      "wireParams": {
        "type": "object",
        "additionalProperties": false,
        "required": ["sessionId"],
        "properties": {
          "sessionId": {
            "type": "string"
          }
        }
      }
    },
```

- [ ] **Step 4: Regenerate the generated reference**

Run: `npm run docs:agent-control`
Expected: `docs/agent-control/generated/commands.md` gains a `transport.file.report` row and
section. Do not edit that file by hand.

- [ ] **Step 5: Run the manifest-driven suites**

Run: `npx vitest run src/agentControl`
Expected: PASS, including `appSnapshot.test.js`, `commandManifest.test.js`,
`publicSurfaceDocs.test.js`, and the bridge catalog test (which now sends the canonical
`sessionId: "file-1"` and receives `fileSessionNotFound`, not `methodNotFound`).

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`
Expected: PASS, including `every_running_manifest_leaf_parses_and_builds_its_declared_wire_method`,
`manifest_entries_appear_once_in_scoped_help_and_harness_commands_never_appear`,
`help_matches_manifest_revision_policies_and_lists_v1_exit_classes`, and the text rejection test.

- [ ] **Step 6: Commit**

```bash
npm run check
git add src/agentControl/commandManifest.json src/agentControl/appSnapshot.test.js src-tauri/src/cli_control.rs docs/agent-control/generated/commands.md
git commit -m "feat(agent-control): publish transport file report" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Public documentation

**Files:**

- Modify: `docs/agent-control/transport.md`
- Modify: `docs/cli.md`
- Modify: `docs/working/agent-control-cli-roadmap.md`
- Test: `scripts/cliDocumentationContract.test.js`

- [ ] **Step 1: Write the failing documentation contract test**

Append inside `describe("current CLI documentation", ...)` in
`scripts/cliDocumentationContract.test.js`:

```js
it("publishes the File analysis report command", () => {
  const cli = read("docs", "cli.md");
  const transport = read("docs", "agent-control", "transport.md");
  const commands = read("docs", "agent-control", "generated", "commands.md");
  const roadmap = read("docs", "working", "agent-control-cli-roadmap.md");

  expect(transport).toContain("transport file report <session-id> --json");
  expect(transport).toContain("fileAnalysisNotComplete");
  expect(transport).toContain("only public file-analysis report format");
  expect(cli).toContain("transport file report");
  expect(cli).toContain("`result.report`");
  expect(commands).toContain("## `transport.file.report`");
  expect(roadmap).toContain("#### 1. File-analysis report export — complete");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run scripts/cliDocumentationContract.test.js`
Expected: FAIL on the `transport.md` assertions.

- [ ] **Step 3: Update `docs/agent-control/transport.md`**

In the Commands code block, add after the `transport file clear` line:

```text
npm run desktop:control -- transport file report <session-id> --json --out mix-report.json
```

Replace the sentence `All Transport commands except \`inspect\` require \`--expected-revision\`.`with`All Transport commands except \`inspect\` and \`file report\` require \`--expected-revision\`.`

Insert this section directly before `## Revision and waiting`:

```markdown
## FILE reports

`transport file report <session-id> --json [--out <file>]` returns the same versioned `fileAnalysis`
report that the GUI's Export button saves, built by the same frontend builder. It is a read: it never
selects the session, changes the source, starts or stops analysis, or increments revision, and it
works in either source mode while the session is retained.

Only `complete` sessions are reported. An unknown ID fails with `fileSessionNotFound`; a `probing`,
`analyzing`, `stopped`, or `error` session fails with `fileAnalysisNotComplete`, whose details carry
the session ID and public state. A stopped session's partial summary does not describe the whole
file, and the report schema has no field that marks a partial report.

The success result is `{ revision, sessionId, report }`. `--out` moves the report into a file and
replaces `result.report` with `result.out`, exactly as library and configuration export do; see
[Output Files](../cli.md#output-files). `fileAnalysis` schema version 1 is the only public
file-analysis report format; the internal capture harness output is not a public contract.
```

- [ ] **Step 4: Update `docs/cli.md` Output Files**

Replace:

```text
the exact same bytes. `<library> export --out <file>` and `config export --out <file>` **move**: the
file receives the pretty-printed exported document, and `result.pack` or `result.configuration` is
replaced by `result.out` in the envelope, so stdout does not carry a duplicate. The document and
```

with:

```text
the exact same bytes. `<library> export --out <file>`, `config export --out <file>`, and
`transport file report <session-id> --out <file>` **move**: the file receives the pretty-printed
exported document, and `result.pack`, `result.configuration`, or `result.report` is replaced by
`result.out` in the envelope, so stdout does not carry a duplicate. The document and
```

Replace `stdout still carries the full \`ok: true\` envelope, including \`result.pack\` or`and the
next line's`\`result.configuration\` — the swap`with`stdout still carries the full \`ok: true\` envelope, including \`result.pack\`,`/`\`result.configuration\`, or \`result.report\` — the swap`.

In the example block, add after the `config export` line:

```powershell
plvs-cli transport file report <session-id> --json --out mix-report.json
```

- [ ] **Step 5: Update the roadmap**

In `docs/working/agent-control-cli-roadmap.md`:

- Change `#### 1. File-analysis report export` to `#### 1. File-analysis report export — complete`.
- Replace the paragraph starting `Open design question: whether report generation is a query` with:
  `Resolved as a running-app query with optional \`--out\`, matching library and configuration
  export. See [\`../superpowers/specs/2026-09-11-agent-control-file-report-design.md\`](../superpowers/specs/2026-09-11-agent-control-file-report-design.md).`
- Change `3. **File report export** as the next already-visible GUI workflow.` to
  `3. **File report export** as the next already-visible GUI workflow (complete).`
- Change `\`--json\` remains stable. File Analysis report export remains.`to`\`--json\` remains stable. File Analysis report export is complete.`

- [ ] **Step 6: Format and verify**

Run: `npx prettier --write docs/agent-control/transport.md docs/cli.md docs/working/agent-control-cli-roadmap.md`
Run: `npx vitest run scripts/cliDocumentationContract.test.js src/agentControl/publicSurfaceDocs.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npm run check
git add docs/agent-control/transport.md docs/cli.md docs/working/agent-control-cli-roadmap.md scripts/cliDocumentationContract.test.js
git commit -m "docs(agent-control): document transport file report" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Desktop acceptance

No code changes. This verifies the real transport end to end.

- [ ] **Step 1: Start the development app**

Run `npm run desktop` in one terminal and wait until the window is up with Agent Control enabled.
When stopping it later, stop it by PID, never by image name, because `taskkill /IM plvs.exe` also
kills an installed release copy.

- [ ] **Step 2: Analyze a short file**

In a second terminal (use `--silent` whenever output is piped):

```bash
npm run --silent desktop:control -- inspect --json
npm run --silent desktop:control -- transport file analyze <short.wav> --expected-revision <revision> --json
npm run --silent desktop:control -- wait --after-revision <revision-after-analyze> --timeout-ms 60000 --json
npm run --silent desktop:control -- transport inspect --json
```

Expected: the new session is `complete`; note its `id`.

- [ ] **Step 3: Report it**

```bash
npm run --silent desktop:control -- transport file report <session-id> --json
npm run --silent desktop:control -- transport file report <session-id> --json --out mix-report.json
npm run --silent desktop:control -- transport file report missing-id --json
```

Expected:

- first: `ok: true` with `result.report.reportType == "fileAnalysis"`, and the numbers match the
  GUI summary bar;
- second: `result.out` set, no `result.report`, and `mix-report.json` equals the first report except
  `exportedAt`;
- third: `ok: false`, `error.code == "fileSessionNotFound"`, exit code 3.

Also press Export in the GUI for the same session and confirm the saved file matches the CLI report
apart from `exportedAt`.

- [ ] **Step 4: macOS**

Ask the user to repeat Steps 1–3 on a Mac; the socket transport is not reachable from Windows.

---

## Out of scope

Headless analysis, FILE-mode time-point/range measurement, partial-session reports, and any change
to the `fileAnalysis` v1 schema.
