# Agent Control: macOS Transport Design

Date: 2026-09-08

Status: Approved for implementation

## Summary

PLVS already ships the same thin `plvs-cli` companion inside the macOS application bundle, and
the CLI already supports offline commands such as `doctor` and `schema`. Live Agent Control is
unavailable only because the running application and CLI have no macOS local transport and the
surrounding lifecycle code is wired directly to the Windows named-pipe implementation.

This design adds a macOS Unix-domain-socket transport while preserving the existing JSON-RPC,
broker, frontend command bus, revision, safety, persistence, and public CLI contracts. It also
introduces one platform-neutral Rust transport boundary so callers no longer know whether the
native endpoint is a Windows named pipe or a macOS Unix socket.

The first phase covers every existing Agent Control command whose underlying PLVS capability is
available on macOS. Windows-only native features remain honestly unavailable through their existing
capability and error contracts. In particular, macOS Visual Capture is a separate follow-on design.

## Goals

- Make live Agent Control available in development and release macOS builds.
- Reuse the complete existing public command surface and React business functions.
- Preserve development/release app-identity isolation.
- Preserve the current-user security boundary and per-launch token authentication.
- Preserve bounded framing, concurrency, request timeouts, cancellation, and response delivery
  semantics.
- Preserve the rule that the first running instance for one app identity owns Agent Control.
- Make Windows and macOS transport selection invisible to CLI parsing, toggle logic, application
  startup, and shutdown.
- Keep the macOS application bundle self-contained; Agent Control must work when the CLI is invoked
  by its full path even when it is not on `PATH`.

## Non-goals

- macOS screenshot or recording support for the `visual` family.
- Linux transport delivery.
- TCP, HTTP, WebSocket, or any remotely reachable listener.
- multiple simultaneously controllable sessions or a new `--session` selector;
- changes to public command names, JSON result envelopes, revision semantics, or exit codes;
- automatic edits to `.zprofile`, `.zshrc`, other shell startup files, `/usr/local/bin`, or
  `/opt/homebrew/bin`;
- changing macOS platform limitations already reported by View or Dock Control;
- changing the audio callback, DSP, capture engine, or measurement data path.

## Existing reusable system

The following layers are already platform-neutral and remain authoritative:

- `src-tauri/src/agent_control/protocol.rs` owns JSON-RPC parsing and response encoding.
- `src-tauri/src/agent_control/broker.rs` owns correlation, pending limits, frontend readiness,
  timeout, cancellation, and delivery confirmation.
- `src/agentControl/useAgentControlBridge.js` routes requests through the running React
  application's normal business functions and persistence barriers.
- `src-tauri/src/cli_control.rs` owns public CLI parsing, stable output envelopes, file/stdin
  handling, and exit classes.
- `src-tauri/src/agent_control/discovery.rs` owns identity-scoped descriptors and per-launch
  authentication tokens.
- `src-tauri/plvs-cli` already locates the adjacent non-Windows `plvs` host, forwards `--cli` plus
  its compiled identity, and relays stdout, stderr, and exit status.
- macOS bundles already contain `Contents/MacOS/plvs-cli`, and the DMG smoke check verifies it.

No Agent Control mutation may bypass these layers or mutate Rust/native state directly as a macOS
shortcut.

## Target architecture

```text
plvs-cli
    |
    v
agent_control::transport             platform-neutral API
    |-- Windows: named pipe
    `-- macOS:  Unix domain socket
                 |
                 v
              Broker
                 |
                 v
          Tauri event/command bridge
                 |
                 v
        React Agent Control handlers
                 |
                 v
      normal PLVS business functions
```

The platform-neutral API owns the vocabulary used by the rest of the application:

```rust
pub struct ServerState { /* platform implementation */ }

pub fn start(app: &tauri::AppHandle) -> Result<(), String>;
pub fn call_with_timeout(
  descriptor: &AgentControlDescriptor,
  request: &JsonRpcRequest,
  response_timeout: Duration,
) -> Result<Value, TransportError>;
```

`toggle.rs`, `lib.rs`, and `cli_control.rs` call only this API. Platform modules own native address
creation, binding, accepting, connecting, peer verification, disconnection checks, native I/O, and
listener wake-up.

## Rust module layout

The intended end state is:

```text
src-tauri/src/agent_control/
|-- mod.rs
|-- broker.rs
|-- discovery.rs
|-- protocol.rs
|-- framing.rs
|-- toggle.rs
|-- transport.rs
`-- transport/
    |-- windows_pipe.rs
    `-- macos_socket.rs
```

`framing.rs` contains transport-independent byte framing and authentication-envelope logic now
embedded in `windows_pipe.rs`: the four-byte little-endian length prefix, size limits, complete
read/write loops, UTF-8 and JSON validation, constant-time token comparison, and internal delivery
acknowledgement representation.

Platform I/O adapters implement `Read` and `Write` or call the shared helpers with equivalent
deadlines. Public errors use one `TransportErrorReason`; user-visible CLI error mapping must not
depend on Windows type names.

This refactor must preserve Windows behavior. It is not permission to rewrite the broker, public
protocol, frontend bridge, or command surface.

## Discovery descriptor and native address

The descriptor remains `agent-control.json` under the identity-specific configuration directory.
Its schema remains version 1 because its existing `endpoint` string is transport metadata and the
JSON shape does not change.

On Windows, `endpoint` remains the logical named-pipe endpoint currently used.

On macOS, `endpoint` contains the absolute Unix-socket path selected by the owning application.
The CLI uses the descriptor value rather than independently deriving the directory from its own
environment. This matters because a GUI launched by Finder and a CLI launched by a terminal need
not inherit identical environment variables.

The macOS socket path is created below the launching user's temporary directory, with a short,
stable filename derived from the complete app identifier:

```text
<user temp>/plvs-control-<short identity hash>.sock
```

The implementation must reject a path that cannot fit in macOS `sockaddr_un.sun_path`; it must not
truncate or silently choose a colliding name. The full app identifier, descriptor app identity,
protocol version, PID, and per-launch token remain independently validated, so the shortened native
filename does not weaken identity separation.

The descriptor token is security-sensitive. On macOS its containing identity directory must be
private to the current user and the committed descriptor must have mode `0600`. Atomic replacement
must not introduce a window in which another local user can read the token.

## macOS endpoint ownership and crash recovery

A filesystem socket can survive an application crash. A second process must not infer ownership
from the pathname alone and must never unconditionally unlink an endpoint that a live PLVS instance
owns.

Each app identity therefore has an advisory ownership lock in its private configuration directory.
The lifecycle is:

1. Open the identity-specific lock file and attempt an exclusive, non-blocking lock.
2. If the lock is held, leave the new PLVS window running normally, log that Agent Control is
   unavailable for this instance, and do not modify the descriptor or socket.
3. If the lock is acquired, remove an old socket only after verifying that it is a socket at the
   expected owned path.
4. Bind and listen, set the socket mode to `0600`, then atomically write the descriptor.
5. Hold the lock for the complete server lifetime.
6. On graceful shutdown, stop accepting, drain or settle active workers, shut down the broker, and
   remove only the socket and descriptor still owned by the current PID/token/server.
7. On a crash, the kernel releases the lock. The next owner may then remove the stale socket safely.

This is the macOS equivalent of the Windows first-pipe-instance rule.

## Current-user authentication

The macOS boundary uses three layers:

1. the descriptor and ownership lock live in an identity directory accessible only to the current
   user;
2. the socket has mode `0600`, and both accepted server connections and client connections verify
   the peer effective UID with macOS peer-credential APIs;
3. every connection must present the existing cryptographically random per-launch token, compared
   in constant time.

The token must never appear in argv, logs, errors, successful CLI JSON, or debug formatting. No
network listener or fallback transport is permitted.

## Framing and request lifecycle

The macOS transport preserves the current one-request-per-connection model:

```text
client -> authenticated request frame
server -> JSON-RPC response frame
client -> transport delivery acknowledgement when requested
close
```

A frame is a four-byte little-endian length followed by exactly that many bytes. The existing
request, authentication-envelope, and response limits remain unchanged. Empty, oversized,
truncated, trailing, invalid UTF-8, malformed JSON, and unauthenticated messages retain stable
transport classifications.

The server retains the current bounded worker model. Slow or malicious local clients cannot create
unbounded threads, queue entries, allocations, or waits. Native read/write operations use explicit
deadlines and remain outside the audio callback path.

While a request is pending in the frontend, the server checks whether the Unix peer disconnected so
the broker can cancel work rather than wait for the complete frontend timeout. The check must not
consume application payload bytes.

## Delivery acknowledgement and relaunch safety

Configuration import can return `relaunch: true`. The frontend deliberately waits until Rust knows
that the CLI received the response before relaunching PLVS. Windows currently obtains this guarantee
from named-pipe delivery behavior; Unix-stream `flush` only transfers bytes into a kernel buffer and
does not prove that the client read them.

For a response whose broker submission requests delivery confirmation:

1. the server writes the complete response frame;
2. the CLI reads and parses the complete response and verifies the response/request identity;
3. the CLI writes a bounded transport acknowledgement containing the request identity;
4. the server validates the acknowledgement and calls `confirm_delivery(Ok(()))`;
5. only then may the frontend's relaunch path continue.

An absent, malformed, mismatched, or late acknowledgement confirms delivery failure. It never
turns an uncertain delivery into success. The acknowledgement is internal transport framing and
does not change the public JSON-RPC protocol version or CLI output.

Windows may retain its native delivery mechanism in this phase. Shared framing must not weaken the
existing Windows guarantee.

## Process liveness

The non-Windows placeholder that treats every PID as alive is replaced on macOS with a real
`kill(pid, 0)` probe:

- success or `EPERM` means the process may be alive;
- `ESRCH` means the descriptor is stale;
- unexpected failures are treated conservatively as possibly alive because an authenticated
  connection remains authoritative.

PID liveness is only a diagnostic optimization. A successful authenticated connection is the final
proof that the application is controllable.

## Toggle, startup, and shutdown

Agent Control remains off by default in release builds and on by default in development-identity
builds. The existing top-level `agentControlEnabled` permission remains excluded from Settings
Control and configuration/profile transfer.

On Windows and macOS:

- enabling starts the native endpoint, writes the descriptor, then persists the permission;
- disabling first removes discoverability and stops new accepts, lets already accepted work settle,
  removes owned native state, then persists the disabled permission;
- application startup restores the endpoint only when the permission is enabled;
- application/window shutdown stops the platform-neutral `ServerState`;
- `agentControl.available` reports platform transport support;
- `agentControl.enabled` reports whether the permission should expose the endpoint.

A failure to bind Agent Control must not prevent the PLVS GUI from starting.

## CLI installation and PATH on macOS

The installed macOS CLI is the executable adjacent to the host at
`Contents/MacOS/plvs-cli`. Development builds use the correspondingly staged sidecar. The status
implementation checks that exact sibling and reports `cliInstalled` independently of `PATH`.

The macOS toggle does not modify shell startup files or privileged binary directories. Full-path
invocation and the bundled `plvs-agent.json` discovery manifest are supported regardless of
`onPath`. `onPath` may report observation only; it is not a prerequisite for enabling the endpoint.
Documentation may show an optional user-created symlink, but PLVS does not create or remove it.

Windows retains its existing user-PATH behavior in this phase.

## Platform capability boundary

Transport support does not make every native PLVS feature cross-platform. After this work:

- all semantic Agent Control families can connect on macOS;
- methods backed by macOS-capable application behavior execute normally;
- unsupported View or Dock options continue to be rejected or omitted according to their current
  contracts;
- `visual.describe` continues to report macOS capture as unavailable;
- screenshot and recording commands continue to return their existing stable unavailable result on
  macOS.

The static command manifest remains cross-platform. Dynamic capabilities and family `describe`
methods remain the authority for runtime availability.

## Error mapping

The platform-neutral transport exposes reasons equivalent to the current Windows classifications:

- authentication failure -> `authenticationFailed`, CLI exit 2;
- connect failure or a stale/unreachable socket -> `appNotRunning`, CLI exit 2;
- response deadline -> `timeout`, CLI exit 2 unless the public command owns a different timeout
  outcome;
- descriptor I/O/validation failure -> existing `discoveryFailed` or `protocolMismatch`;
- other native/framing failure -> `transportFailed`, CLI exit 2.

Messages may name a local endpoint or transport operation but must not expose the token, native file
descriptor, peer credentials, or internal paths not already present in the discovery descriptor.

## Verification

Automated Rust tests cover:

- common framing fragmentation, partial writes, limits, trailing payload, malformed envelopes, and
  constant-time token behavior;
- macOS socket request/response round trips larger than native buffers;
- socket and descriptor permissions;
- same-user peer verification and rejected peer-verification fakes;
- PID liveness classification;
- first-instance lock ownership, a second contender, graceful cleanup, and crash-style stale socket
  recovery;
- client disconnect cancellation, worker and pending limits, read/write/response timeouts;
- delivery acknowledgement success, missing/mismatched acknowledgement, and delivery timeout;
- unchanged Windows framing, authentication, large-message, and delivery behavior;
- common CLI error mapping without platform type names.

Frontend and source-contract tests cover:

- Settings enables Agent Control on Windows and macOS and still disables it on unsupported
  platforms;
- `available` and `enabled` boot state on each supported platform;
- macOS CLI installation detection without PATH mutation;
- public documentation no longer describes all Agent Control as Windows-only;
- generated Agent Control documentation remains source-derived and is not edited by hand.

Manual macOS acceptance uses the real desktop app:

1. Start the development app and verify matching-identity `capabilities`, `inspect`, revision wait,
   measurement wait, and a revision-guarded mutation.
2. Verify the release CLI cannot control the development app and the development CLI cannot control
   a release app.
3. Disable Agent Control and observe `agentControlDisabled`; enable it without restarting and
   connect successfully.
4. Quit the app and observe `appNotRunning`; relaunch and verify the persisted state.
5. Start a second same-identity window and verify it does not replace the first descriptor or
   endpoint.
6. Force-terminate the owner, relaunch, and verify stale socket recovery.
7. Exercise large library/configuration export and import payloads.
8. Perform a real configuration import and prove the complete success response is received before
   application relaunch.
9. Invoke the installed CLI by its full `.app` path with no PATH setup.
10. Confirm `visual describe` remains honest and visual capture attempts fail without affecting the
    rest of Agent Control.

`npm run check` is required before merge. This work does not touch `src-tauri/src/audio`, `dsp`, or
`engine`, so capture smoke and soak are not required.

## Approved decisions

- Phase one includes cross-platform Agent Control transport and every command supported by the
  underlying macOS application; it excludes macOS Visual Capture.
- macOS uses a Unix domain socket, never TCP or HTTP.
- the descriptor carries the selected absolute socket address and keeps schema version 1.
- endpoint ownership uses an identity-scoped advisory lock and safe stale-socket cleanup.
- macOS verifies peer UID in addition to filesystem permissions and the launch token.
- relaunch-sensitive responses use an explicit macOS delivery acknowledgement.
- PLVS does not edit macOS shell configuration or install a privileged symlink.
- Windows behavior and public CLI/JSON-RPC contracts remain compatible.

## Follow-on work

- Design macOS Visual Capture around ScreenCaptureKit, system permission UX, semantic WebView
  cropping, cursor behavior, recording finalization, and optional measured-source audio.
- Consider Linux UDS support after the platform-neutral transport boundary has proven stable.
- Consider multiple Agent Control sessions only as a separate descriptor/discovery protocol change.
