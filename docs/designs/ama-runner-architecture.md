# AMA Runner Architecture

This document fixes the target shape for the Go `ama-runner` implementation.
The goal is to keep the runner boring: one process that registers itself,
polls work, keeps a relay open, executes sandbox or external-runtime work, and
reports lease state through the Go AMA SDK.

## Principles

- Keep packages by capability, not by layer names.
- Keep CLI bootstrap, login/version commands, token refresh, and channel dialing
  in `internal/cmd`.
- Keep the daemon package responsible for process lifecycle, lease orchestration,
  and relay wiring.
- Keep reusable runner build metadata in `pkg/version`.
- Keep generated cross-language session event vocabulary in `pkg/sessionevent`.
- Keep sandbox mechanics in `internal/sandbox`.
- Keep external runtime mechanics in `internal/runtime`.
- Keep workspace materialization in `internal/workspace`.
- Do not introduce a runner-side AMA Server client abstraction. Runner code calls
  the Go SDK facade directly.
- Do not add objects unless they own a real lifecycle or invariant. A struct that
  only groups moved functions is not an improvement.
- Keep cross-language protocol surface small. The Go runner understands only the
  work payloads and relay/sandbox messages it must execute.

## Final Object Model

### `cmd.Application`

CLI/application bootstrap:

- loads config
- builds auth transport
- builds `ama.Client`
- creates the daemon
- handles login/version commands
- opens the per-runner relay channel transport

### `version.Info`

Build metadata shared by CLI output and runner registration/heartbeat metadata:

- binary name
- semantic release version
- commit
- build date

### `sessionevent`

Generated canonical session event vocabulary shared with TypeScript runtime
contracts:

- event type constants
- ordered canonical event type list
- canonical event type membership check

### `daemon.Daemon`

Long-lived runner process:

- registers or recovers runner identity
- sends heartbeats
- refreshes advertised runtime capabilities
- starts the per-runner relay hub
- polls work with bounded concurrency
- drains active leases on shutdown

It does not execute tool calls or runtime sessions directly.

### `daemon.LeaseWorker`

Single work lease orchestration:

- claims one work item
- parses work payload
- checks required runner capability
- renews the active lease
- runs tool work through `sandbox.SandboxAdapter`
- prepares session workspaces for AMA sandbox and external runtime sessions
- starts AMA sandbox sessions by registering a `session.SandboxHandle`
- starts external runtime sessions through `runtime.Runner`
- completes, fails, cancels, or interrupts the lease through `ama.Client`

This is intentionally one object, not a stack of lifecycle/executor/finalizer
objects. A lease is the unit of orchestration.

### `session.Relay`, `session.HostHandle`, and `session.SandboxHandle`

Runner-hosted session relay:

- one shared runner channel
- session command routing by session id
- event backfill from local event store
- command delivery to external runtime sessions
- sandbox request execution for AMA sandbox sessions

The relay lives in `internal/session` because it is runner-hosted session
transport and server protocol wiring. It owns relay socket dispatch, live session
handles, and local event replay; `daemon` only registers the handle for the lease
it is currently running.

### `daemon.IdentityStore`

Persisted runner identity:

- machine id
- runner id
- state file read/write/clear

### `runtime.Inventory`

Advertised external runtime inventory:

- detects local runtime CLIs from the runtime registry
- asks `runtime.Bridge` to probe model availability
- tracks usage windows
- builds external runtime capabilities and runtime inventory for heartbeat metadata

### `runtime.Bridge`

Go client for the embedded TypeScript runtime bridge:

- materializes and starts the bundled bridge process
- sends bridge requests over NDJSON stdin
- reads session events, resume tokens, results, and errors from NDJSON stdout
- forwards control frames to the active bridge request
- probes model availability and provider usage through bridge commands

The bridge owns provider/runtime semantics in TypeScript. Go owns only the local
process boundary, environment boundary, and conversion into runner callbacks.

### `runtime.Runner`

External runtime session execution:

- uses an injected adapter for tests or `runtime.Bridge` by default
- applies the session duration context
- emits runtime events through a callback
- reports whether the run timed out

It does not prepare workspaces, update AMA leases, capture memory-store snapshots,
or know about the runner relay hub. Those are lease orchestration concerns owned
by `daemon.LeaseWorker`.

## Rejected Shapes

- A separate `controlplane` package inside runner: rejected because AMA Server API
  calls belong behind the Go SDK facade, not a runner-specific adapter.
- `LeaseLifecycle` + `ToolLeaseExecutor` + `SessionLeaseExecutor` +
  `RuntimeSession`: rejected as too fragmented. They split one lease lifecycle
  into too many objects without enough independent invariants.
- Moving relay hub into `sandbox` or `runtime`: rejected because relay is
  runner-hosted session relay, command routing, sandbox request handling, and local event replay, not execution logic.
