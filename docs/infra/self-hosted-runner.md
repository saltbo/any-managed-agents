# Self-Hosted AMA Runner

`cmd/ama-runner` is the first self-hosted tool-executor daemon for Any Managed Agents. AMA keeps ownership of the agent loop, work queue, policy decisions, session state, and event storage. The runner leases AMA-owned self-hosted work and reports structured events/results back through the runner protocol API.

The daemon is intentionally not a Pi or PyAgent runtime host. It must not launch local Pi loops, expose runner-local session URLs, or accept unapproved local work.

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

All AMA API calls go through `sdk/go/ama`. The daemon uses `ama.NewRunner` for runner protocol calls and does not maintain a separate API client outside SDK transport configuration.

## Login And Configuration

Authenticate the runner with FlareAuth/OIDC device login before starting the daemon:

```bash
ama-runner login --origin "https://ama.example.com"
```

The command discovers the AMA control plane OIDC metadata from `/api/v1/health`, starts the provider device authorization flow for the registered runner client, prints the verification URL/code, and stores the returned token material in the local runner config file. It never prints access or refresh tokens.

By default, the config file is:

- `$AMA_RUNNER_CONFIG` when set
- `$XDG_CONFIG_HOME/ama-runner/config.json`
- `$HOME/.config/ama-runner/config.json`

The config directory is created with `0700` permissions and the token file is written with `0600` permissions where the host filesystem supports POSIX modes. Treat this file as local operator credential material.

Required daemon configuration can come from environment variables, flags, or a JSON config file.

Environment variables:

```bash
export AMA_ORIGIN="https://ama.example.com"
export AMA_RUNNER_NAME="mac-mini-runner-1"
export AMA_RUNNER_CAPABILITIES="sandbox.exec,sandbox.read,sandbox.write"
export AMA_RUNNER_SANDBOX_ADAPTER="process-unsafe"
export AMA_RUNNER_ALLOW_UNSAFE_PROCESS="true"
export AMA_RUNNER_WORKDIR="/var/lib/ama-runner/workspace"
```

Useful flags:

```bash
ama-runner \
  --origin "$AMA_ORIGIN" \
  --runner-name mac-mini-runner-1 \
  --capabilities sandbox.exec,sandbox.read,sandbox.write \
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

The daemon loads the saved device-login access token at startup when `--token` and `AMA_TOKEN` are not provided. `--token` and `AMA_TOKEN` remain available for tests and temporary compatibility, and they take precedence over the saved token. Operators should prefer `ama-runner login` for normal self-hosted runners.

The daemon fails fast when origin, token, runner id/name, capabilities, work directory, adapter selection, or timing values are invalid. `--runner-id` can be used for an existing registered runner. Without a runner id, the daemon registers a runner using `--runner-name`. Runner registration stores only OIDC subject/client binding metadata, safe capabilities, heartbeat/load state, and secret references; raw token material is not stored in D1 or returned by runner APIs. Runner device-login tokens are accepted only for runner registration and runtime runner APIs, not for general control-plane resources such as environments, agents, sessions, providers, or vaults.

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

1. Checks `/api/v1/health` for an AMA control plane.
2. Loads the saved FlareAuth/OIDC device-login token unless an explicit token override is supplied.
3. Registers a runner when no runner id is configured.
4. Sends an active heartbeat with capabilities and adapter metadata.
5. Lists available work with `GET /api/v1/work-items` and claims it with `POST /api/v1/leases`.
6. Uploads structured lease events.
7. Renews active leases while local work is running.
8. Finishes leases as `completed`, `failed`, or `cancelled`.

`204` lease responses mean no eligible work is available. Authentication failures, runner-token binding failures, unsupported payload protocols, unsupported sandbox backends, and incompatible control planes are fatal.

Current AMA self-hosted session creation queues `session.start` work. The daemon handles that work as a cloud-owned session handoff: it uploads a structured `runner.session.started` event and completes the lease without launching Pi/PyAgent locally. Approved `sandbox.exec`, `sandbox.read`, and `sandbox.write` tool payloads are the only work items that enter the local process adapter.

## Cancellation Status

The daemon cancels local work and reports `cancelled` when its local process receives cancellation. It also cancels local work if a lease renewal fails, because a `409` means the lease no longer owns the work item.

The current API does not yet expose a control-plane initiated cancellation signal for an already running self-hosted lease. Operators should treat that as a known API gap: AMA can accept runner-sent `cancelled` lease updates, but the runner cannot poll a first-class cancellation resource yet.
