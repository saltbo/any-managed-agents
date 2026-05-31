# Self-Hosted AMA Runner

`cmd/ama-runner` is the first self-hosted tool-executor daemon for Any Managed Agents. AMA keeps ownership of the control plane, work queue, policy decisions, session state, and event storage. The runner leases `self_hosted` environment runtime work and reports structured events/results back through the public control-plane API.

The daemon is intentionally not a standalone product control plane. It must not expose runner-local session URLs or accept unapproved local work.

## Build

```bash
cd cmd/ama-runner
go test ./...
go build ./...
```

The runner module depends on the repo-local generated Go SDK:

```go
require github.com/saltbo/any-managed-agents/sdk/go v0.0.0
replace github.com/saltbo/any-managed-agents/sdk/go => ../../sdk/go
```

All control-plane calls go through `sdk/go/ama`. The daemon does not maintain a separate API client outside SDK transport configuration.

## Configuration

Required configuration can come from environment variables, flags, or a JSON config file.

Environment variables:

```bash
export AMA_ORIGIN="https://ama.example.com"
export AMA_TOKEN="..."
export AMA_RUNNER_NAME="mac-mini-runner-1"
export AMA_RUNNER_CAPABILITIES="runtime:codex,provider:workers-ai,model:@cf/moonshotai/kimi-k2.6,sandbox.exec,sandbox.read,sandbox.write"
export AMA_RUNNER_SANDBOX_ADAPTER="process-unsafe"
export AMA_RUNNER_ALLOW_UNSAFE_PROCESS="true"
export AMA_RUNNER_WORKDIR="/var/lib/ama-runner/workspace"
```

Useful flags:

```bash
ama-runner \
  --origin "$AMA_ORIGIN" \
  --token "$AMA_TOKEN" \
  --runner-name mac-mini-runner-1 \
  --capabilities runtime:codex,provider:workers-ai,model:@cf/moonshotai/kimi-k2.6,sandbox.exec,sandbox.read,sandbox.write \
  --sandbox-adapter process-unsafe \
  --allow-unsafe-process \
  --workdir /var/lib/ama-runner/workspace
```

Timing defaults:

- Lease duration: `60s`
- Lease renewal interval: `20s`
- Heartbeat interval: `20s`
- Poll interval when no work is available: `5s`
- Max concurrent leases: `1`

The daemon fails fast when origin, token, runner id/name, capabilities, work directory, adapter selection, or timing values are invalid. `--runner-id` can be used for an existing registered runner. Without a runner id, the daemon registers a runner using `--runner-name`.

## Local Executor Boundary

The only v1 adapter is `process-unsafe`. It is marked unsafe because it executes commands directly on the host with the configured work directory as the workspace boundary.

`process-unsafe` supports only approved AMA tool work for:

- `sandbox.exec`
- `sandbox.read`
- `sandbox.write`

The adapter captures stdout, stderr, exit code, structured output, and errors. File reads/writes are constrained to the configured work directory, including symlink boundary checks. Command cancellation uses context cancellation and process-group termination on Unix-like hosts.

`sandbox.exec` starts child commands with an explicit minimal environment. AMA control-plane credentials and `AMA_*` runner/operator configuration are not passed to leased commands. `HOME` and temp directories are set to runner-controlled directories inside the configured workspace so host operator config paths are not inherited.

Do not use this adapter for untrusted workloads. Docker/OCI isolation should be added later as a separate adapter behind the same interface.

## Control-Plane Loop

At startup, the daemon:

1. Checks `/api/health` for an AMA control plane.
2. Registers a runner when no runner id is configured.
3. Sends an active heartbeat with capabilities and adapter metadata.
4. Claims work with `POST /api/runners/{runnerId}/leases`.
5. Uploads structured lease events.
6. Renews active leases while local work is running.
7. Finishes leases as `completed`, `failed`, or `cancelled`.

`204` lease responses mean no eligible work is available. Authentication failures, unsupported payload protocols, unsupported sandbox backends, and incompatible control planes are fatal.

Current AMA `self_hosted` session creation queues `session.start` work for runners that advertise the exact runtime, provider, and model combination. The daemon uploads canonical AMA session events and completes the lease. Approved `sandbox.exec`, `sandbox.read`, and `sandbox.write` tool payloads are the only work items that enter the local process adapter.

## Cancellation Status

The daemon cancels local work and reports `cancelled` when its local process receives cancellation. It also cancels local work if a lease renewal fails, because a `409` means the lease no longer owns the work item.

The current API does not yet expose a control-plane initiated cancellation signal for an already running `self_hosted` lease. Operators should treat that as a known API gap: AMA can accept runner-sent `cancelled` lease updates, but the runner cannot poll a first-class cancellation resource yet.
