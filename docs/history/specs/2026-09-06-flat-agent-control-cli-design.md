# Flat Agent Control CLI

Date: 2026-09-06
Status: Approved

## Decision

Remove the public `app` command layer without an alias or migration period. Agent Control commands
are organized directly by product resource or operation:

```text
plvs-cli capabilities --json
plvs-cli inspect --json
plvs-cli wait --after-revision 0 --json
plvs-cli workspace apply layout.json --json --expected-revision 0
plvs-cli panel describe spectrum --json
```

`plvs-cli app ...` and `plvs-cli help app` are unknown commands. The repository
`desktop:control` entrypoint still selects the development identity, but forwards its arguments
unchanged instead of injecting a command prefix.

CLI hierarchy follows the resource or operation, not whether a command needs the running desktop
app. `doctor` works without PLVS; every other current public command requires the matching running
app and Agent Control endpoint. Future offline commands such as `analyze` may coexist at the root.

## Protocol boundary

The CLI change does not rename JSON-RPC methods. `app.capabilities`, `app.inspect`, and `app.wait`
remain application-level wire methods; domain methods such as `panel.update` and
`workspace.applyLayout` are also unchanged. Descriptor and portable-file `app` fields keep their
existing meanings and formats.

Capabilities advertise wire operations through `methods`. The duplicate `commands` field is
removed because its values were methods rather than CLI command paths. Human and agent callers use
the CLI help tree to discover argv syntax.

## Naming and help

The product feature is called Agent Control. CLI implementation types use Control rather than App
to avoid implying a removed public namespace. Root help groups diagnostics separately from
running-app commands; command-family help remains available through `<command> --help`.

## Documentation history

Living CLI, Agent Control, architecture, contributor, landing, and roadmap documentation uses the
flat syntax. Earlier specs and implementation plans remain historical records; notes on the
superseded designs point here rather than rewriting what those deliveries originally implemented.
