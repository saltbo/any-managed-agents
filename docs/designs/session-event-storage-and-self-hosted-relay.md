# Session Event Storage + Self-Hosted Relay

Status: approved — executable brief. This document is the single source of
truth for the implementation. Build exactly what it specifies, in the phased
order below, passing each phase's gate before the next, until the Acceptance
criteria are met. If anything here conflicts with code or assumptions, this
document wins.

## Scope & repositories

- **Server + SDK**: `/Users/saltbo/Develop/bogit/any-managed-agents` — the AMA
  control plane, the OpenAPI-generated SDKs, and the `Session`/`Sandbox` Durable
  Objects. Branch off the merged `main`.
- **Client**: `/Users/saltbo/Develop/bogit/agent-kanban` (AK) — the web UI and
  the `ak` CLI; consumes `@any-managed-agents/sdk` via a git pin. Work on branch
  `codex/ama-runtime-integration`.

## Problem

Every session emits a canonical event stream (the agent's behaviour, rendered in
the chat box). Today:

- All events — cloud-hosted *and* self-hosted — are written to a single
  relational table `session_events` in the control-plane D1 (`server/db/
  schema.ts`).
- The browser reads them over **SSE** (`GET /sessions/{id}/events`,
  `text/event-stream`, ~1 s polling, server→browser only) and sends prompts over
  a separate **REST** `POST /sessions/{id}/messages`.
- The only WebSocket is runner↔AMA (`RunnerSessionChannelObject`,
  `GET /leases/{id}/channel`), not browser-facing.

Three problems:

1. **Volume vs D1.** The event stream is a high-rate append-only firehose with
   no relational-join needs. A shared single-primary D1 (10 GB cap, write
   contention) is the wrong substrate at scale.
2. **Self-hosted data locality.** Self-hosted runs compute locally but still
   upload their full transcript to the cloud (`runner-channel-ingest.ts`
   redact-and-appends into cloud `session_events`). That contradicts the point
   of self-hosting.
3. **Split, half-duplex session protocol.** SSE (read) + REST POST (write) is
   two transports, one-directional each, with polling latency.

## Decisions

- **One per-session communication+data object.** Generalise the existing
  `RunnerSessionChannelObject` (already sharded by `sessionId`) into a single
  **`Session` Durable Object** that owns the browser transport, the cloud event
  store, and the self-hosted runner bridge. **Do not add a separate event-log
  DO** — it shares the same `sessionId` shard and lifecycle.
- **Browser session transport is WebSocket.** One bidirectional socket carries
  live events (server→browser), historical replay (on request), and inbound
  prompt/abort/steering/approval (browser→server). SSE may remain as a degraded
  fallback. `/sessions/{id}/connection` advertises `transport: "websocket"`.
- **Storage follows the loop, not the hosting mode.** Where the agent loop runs
  decides where its events live:
  - **`ama` runtime (loop in the cloud)** → events/transcript are **always**
    stored in the cloud (`Session` DO SQLite hot + one R2 object per session
    cold; not KV, not D1), **regardless of where its Sandbox runs** (Cloudflare or
    self-hosted). Once the loop is in the cloud it already holds the full context
    to build each prompt, so withholding persistence would be high complexity for
    near-zero privacy gain.
  - **CLI runtimes (`claude-code`/`codex`/`copilot`, loop local on the runner)** →
    **relay-only**: events live only on the runner; the cloud stores no copy; the
    `Session` DO bridges browser WS ⇄ runner WS. **Runner offline ⇒ history
    unavailable, accepted** (locality over availability — confirmed product call).
- **The `ama` loop moves to the cloud — part of this goal (not a follow-up).**
  Today `ama` runs its turn engine on the local runner
  (`runtime-bridge/src/providers/ama.ts`). This goal relocates the `ama` loop to
  the cloud turn driver and decouples it from the Sandbox: the cloud loop runs
  and **dispatches tool execution to a Sandbox that may be Cloudflare-hosted or
  self-hosted** (for `ama`, the runner becomes a dispatched sandbox host, not a
  loop host). CLI runtimes keep their local loop.
- **UX honesty.** The `ama` runtime stores the transcript in the cloud even when
  its Sandbox is self-hosted. Data locality is available only via a local-loop
  (CLI) runtime; surface this so a user self-hosting a sandbox does not assume
  locality.
- D1 keeps only the **session index/metadata** (list, filter by project/state),
  never the per-event firehose.

### Why not KV (rejected)

Whole-value put → append is read-modify-write a per-session blob: (1) no atomic
append, concurrent writers (cloud turn + runner + retries) clobber each other
and the `UNIQUE(sessionId, sequence)` guarantee is unenforceable; (2) ~1
write/sec/key vs a multi-event/sec live stream; (3) eventual consistency (~60 s)
vs live tailing; (4) 25 MiB value cap vs long transcripts. A `sessionId`-sharded
**SQLite DO** — already the codebase pattern (`Sandbox`,
`RunnerSessionChannelObject`) — gives atomic serialized append, native sequence,
strong consistency, local SQL filtering/pagination, and native WebSocket
hosting. R2 (5 TiB/object, cheap, immutable) is the right "one file per session"
archive.

## Backward compatibility (old AK clients)

**Requirement.** After the new AK server deploys, an **un-upgraded `ak` client
(the legacy daemon) that is still running MUST keep showing its task's session
data in the web UI**, for as long as that old client runs. A server upgrade must
not blank out sessions driven by old clients.

**Current state — NOT met.** Two end-to-end breaks (verified on the AK side):

- The live chat (`ChatPanel`) renders only `AmaRuntimeProvider`, sourced from
  `GET /api/tasks/:id/runtime`, which **404s** when the task has no
  `ama.sessionId` annotation (`apps/web/server/routes.ts:1336`). A legacy daemon
  task is not AMA-bound → the chat gets nothing.
- The legacy renderer still exists but is **unwired**: `RelayRuntimeProvider` +
  `useSessionRelay` + `convertEvents` (RelayEvent → assistant-ui) read the old
  tunnel, but nothing in the live `ChatPanel` mounts them.

**Surviving legacy plumbing** (so this is wiring, not rebuild): the `TunnelRelay`
DO (`TUNNEL_RELAY` binding, exported from the worker) and `GET /api/tunnel/ws`
(tagged `X-AK-Runtime-Surface: legacy-daemon`) are still present — an old daemon
can still connect and relay `AgentEvent`s.

**Fix direction.**

- `ChatPanel` branches per task: `ama.sessionId` present → `AmaRuntimeProvider`
  (the AMA WebSocket stream); absent → `RelayRuntimeProvider` (the legacy
  tunnel). Keep the legacy path wired for the deprecation window.
- The `/runtime` 404 for non-AMA tasks is acceptable — legacy tasks use the
  tunnel, not `/runtime`.
- Out of scope for this doc but required for an old client to function at all:
  its task-claim / machine APIs must still work on the new server (verify
  separately).

## Two Durable Objects, two orthogonal axes

| Axis | DO | Modes | Owns |
|------|----|-------|------|
| **Compute** | `Sandbox` (Cloudflare Sandbox SDK, DO + container) | cloud only | container exec: filesystem, shell, code execution |
| **Comms + data** | `Session` (evolved from `RunnerSessionChannelObject`, `idFromName(sessionId)`) | cloud + self_hosted | browser WebSocket hub; cloud event store; self-hosted runner bridge |

These are different concerns — *where the agent computes* vs *how events are
stored and transported*. The `Sandbox` row is the Cloudflare-hosted sandbox; for
`ama` the cloud loop dispatches tool execution to a Sandbox that is **either**
the Cloudflare `Sandbox` **or** a self-hosted runner-sandbox (sandbox-anywhere).
`Sandbox` is vendor-owned and container-heavy, so the comms/data plane must not
be folded into it. Two DOs is
the floor; the previously-proposed third (a standalone event-log DO) collapses
into `Session`.

## Architecture — the `Session` DO

One instance per `sessionId`. Behaviour branches on **where the loop runs** —
cloud (`ama` runtime) vs local (CLI runtimes) — not on `hostingMode`; the
browser-facing contract is identical either way.

```
            browser ──WebSocket──►  Session DO  (idFromName(sessionId))
                                        │
   ┌── ama (loop in cloud) ─────────────┤  events appended to in-DO SQLite,
   │                                     │  pushed to browser; archived to R2 on close
   │                                     │  (its Sandbox may be cloud OR self-hosted)
   │                                     │
   └── CLI runtime (loop on runner) ─────┤  bridges browser WS ⇄ runner WS;
                                          │  NO cloud storage (relay-only)
                                          ▼
                                   runner (local store, serves over the tunnel)
```

### Browser transport (both modes)

- A single WebSocket: `Session` DO accepts it (hibernatable, so idle sockets
  cost nothing).
- Server→browser frames: live appended events; a `backfill`/replay response for
  a requested `(cursor, limit, filters)` range.
- Browser→server frames: `prompt` (replaces the live use of `POST /messages`),
  `abort`, `steer`, `approval-decision`. REST `POST /sessions/{id}/messages` and
  the SSE read stay as non-WS fallbacks.
- `GET /sessions/{id}/connection` returns `{ transport: "websocket", path: <ws
  url>, state, stateReason }`. The schema already carries `transport`/`path`, so
  no contract reshape — only the advertised value changes.

### Cloud-loop runtimes (`ama`) — event store in the `Session` DO

Applies whenever the loop runs in the cloud (`ama`), independent of where the
Sandbox runs.

- In-DO SQLite mirrors today's canonical row: `sequence` (monotonic per
  session, PK), `type`, `visibility`, `role`, `parentEventId`, `correlationId`,
  `payload`, `metadata`, `createdAt`.
- **Append**: serialized by the DO single-thread → atomic, in-DO sequence,
  idempotent on `(sessionId, sequence)`. The cloud turn driver writes here
  instead of D1 `session_events`. The DO fans appends out to the browser socket.
- **Read/replay**: local SQL with the existing filters + cursor pagination,
  returned over the socket (or the REST fallback).
- **Archive**: on terminal state, serialise the log to one R2 object
  (`sessions/{sessionId}/events.jsonl`); the DO may then evict. Reopening
  rehydrates read-only from R2.

### Local-loop runtimes (CLI) — relay-only bridge

Applies to the self-hosted CLI runtimes (`claude-code`/`codex`/`copilot`) whose
loop runs on the runner.

- **The relay hub is the `Session` DO keyed by `runnerId`** (not `sessionId`) —
  one instance per runner, the shape of the old AK `TunnelRelay`. **Both ends
  connect to that one instance**: the runner opens ONE persistent WebSocket
  (shared across all its leases, reconnecting on restart), and the browsers for
  that runner's CLI sessions connect to it too. The DO multiplexes by `sessionId`
  carried **per-frame** — the channel is no longer bound to one session. Live
  events fan to the browsers matching that `sessionId`; a `backfill` request is
  relayed to the runner for that `sessionId`. No cloud event storage. The
  per-`sessionId` `Session` instance is used only for cloud-loop (`ama`) storage.
  (Earlier this owned the runner WebSocket **per session** — that was the bug; see
  Availability.)
- The runner gains a **local durable event store** (SQLite/framed file, one per
  session). Today `runtime-bridge` only `write({type:'event'})` upstream
  (stream-and-forget); it becomes **store-and-serve**, surviving a runner
  restart (on disk, not in the turn process) — mirroring the old AK daemon.
- `runner-channel-ingest` **stops** persisting runner events into cloud
  `session_events`.
- Historical reads: the browser's `backfill` frame is relayed to the runner,
  which answers from its local store with the same `(cursor, filters)` semantics.
  Live events keep flowing over the bridge. The runner's local read MUST match
  the cloud store's query contract exactly — one contract, two implementations.

## Write paths after the change

| Path | Today | Target |
|------|-------|--------|
| `ama` events (loop in cloud; any Sandbox location) | D1 `session_events` | `Session` DO SQLite → R2 on close |
| CLI-runtime self-hosted events (loop on runner) | redact + append to cloud D1 | runner local store only |
| Browser ← live events | SSE (~1 s polling) | `Session` DO WebSocket push |
| Browser → prompt/abort/steer | REST `POST /messages` | same WebSocket (REST fallback) |
| Session list/metadata | D1 | D1 (unchanged) |

## Availability & UX

- Self-hosted history is available **whenever the runner is online** — running,
  `in_review`, or `done` alike — because the relay connection is **per-runner**,
  not per-session. An implementation that binds the connection to a session's
  lease breaks this: the data is still on disk but unreachable once the session
  completes. The contract is `runner online ⇒ available`, never tied to session
  state.
- Self-hosted + runner offline ⇒ the WebSocket connect / `backfill` returns a
  typed `runner_unavailable` (not a 500); the browser renders "runner offline —
  session history lives on the runner and is not reachable now." Live obviously
  needs the runner online too. Accepted trade.
- Cloud sessions are always available (DO/R2).

## Security

- Self-hosted stores nothing in the cloud, so the cloud-leak surface for local
  data disappears; redaction-before-cloud-store becomes moot for that path.
- The `Session` DO authorises that the connecting browser user owns the session
  (and, for self-hosted, the bound runner) before accepting the socket or
  bridging. The runner stays "untrusted" for what it may write into shared/cloud
  state; for reads it serves the owning user their own data.

## Migration

1. Evolve `RunnerSessionChannelObject` → `Session` DO (rename/extend; keep the
   thin-socket-shell split, control logic stays in usecases). Add R2 bucket
   binding. No data backfill — new sessions only; old sessions keep reading D1
   until drained/archived.
2. Add the browser WebSocket to the `Session` DO; flip `/sessions/{id}/connection`
   to advertise `transport: websocket`; keep SSE + `POST /messages` as fallbacks.
3. Cloud mode: write turn events into the DO SQLite (behind a flag), read/replay
   from it, archive to R2 on close. Migrate or dual-read pre-migration D1 rows.
4. Self-hosted mode: add the runner local store + the relayed `backfill` read;
   stop the cloud append in `runner-channel-ingest`.
5. Shrink `session_events` to cloud-only history, then retire it once all cloud
   events live in DO/R2.

## SDK & client integration (typed WebSocket without a second spec)

OpenAPI 3.x cannot describe a WebSocket message protocol — it can only document
the HTTP upgrade endpoint (the existing `connectLeaseSessionChannel` is a `GET`
with a `101` upgrade + a `LeaseChannelMetadata` JSON "for OpenAPI clients"
fallback; the frames are invisible to codegen, which is why the Go SDK's socket
logic is hand-written in `runners.go`). AsyncAPI is the spec built for this, but
it cannot be derived from the Hono routes — hand-authoring it would reintroduce
the drift this project forbids. So we keep one spec and split the concern:

- **Types stay generated.** Declare the WebSocket frame messages as OpenAPI
  `components.schemas` so they land in `types.gen.ts` — route/spec-derived, no
  drift:
  - server→client: `SessionEvent` (reused), `SessionBackfillResponse`,
    `SessionRunnerUnavailable`.
  - client→server: `SessionPromptFrame`, `SessionAbortFrame`, `SessionSteerFrame`,
    `SessionApprovalFrame` (a discriminated `SessionClientFrame` union).
- **Transport is hand-wrapped in the facade.** Add a typed WebSocket client to
  the hand-maintained facade (`sdk/typescript/src/client.ts`) — the same place
  that already owns what codegen can't express (mirrors the Go `runners.go`
  precedent):

  ```ts
  const stream = client.sessions.stream(sessionId)
  for await (const event of stream.events) { render(event) }   // typed SessionEvent
  await stream.send({ type: 'prompt', content })               // typed SessionClientFrame
  await stream.backfill({ cursor, limit })                     // typed replay
  stream.close()
  ```

  ~50 lines of socket plumbing over `/sessions/{id}/connection` (which now
  advertises `transport: "websocket"`); every payload is typed against the
  generated schemas. The default client `createClient` and raw functions stay as
  the REST fallback.

### AK consumer

AK's chat currently polls `GET /sessions/{id}/events` every 2 s
(`ChatPanel.tsx` `LIVE_POLL_MS = 2000`) — paginated JSON polling, not even using
the SSE the endpoint already offers. After the facade `stream()` lands, AK drops
the poll loop and consumes `client.sessions.stream(sessionId)`: live events
arrive pushed, history comes from `stream.backfill(...)`, and prompts go out
over the same socket instead of `POST /messages`.

### Ordering

1. Server: `Session` DO browser WebSocket (above).
2. Spec: add the frame schemas to OpenAPI `components` → regenerate SDK types.
3. Facade: add `client.sessions.stream()` (send/receive/backfill).
4. AK: delete `LIVE_POLL_MS` polling, consume `stream()`.

## Implementation plan & gates

Build in three phases. A phase's gate must be green before starting the next.
Commit each logical unit; push the SDK before AK consumes it.

**Phase 1 — Server `Session` DO** (any-managed-agents). Evolve
`RunnerSessionChannelObject` into the per-session `Session` DO per *Architecture*.
**Storage keys on loop location (runtime), not `hostingMode`**: cloud-loop
runtimes (`ama`) = in-DO SQLite event store + browser WebSocket push + R2 archive
on close; local-loop CLI runtimes (`claude-code`/`codex`/`copilot`) = bridge
browser WS ⇄ runner WS with no cloud storage, the runner becomes store-and-serve
with a relayed backfill read, stop the CLI-runtime cloud append; shrink D1 to the
session index. Add the `Session` DO binding + sqlite migration and the R2 bucket
binding.
- Gate: `pnpm run lint && pnpm run lint:types && pnpm run typecheck && pnpm run
  openapi:check && pnpm run test:coverage` and `pnpm exec vitest run --project
  integration` all green; `go build ./... && go vet ./... && go test ./...`
  green in both `sdk/go` and `cmd/ama-runner`.

**Phase 1b — Relocate the `ama` loop to the cloud + dispatched Sandbox**
(any-managed-agents; in this goal, not a follow-up). Move the `ama` turn engine
off the local runner (`runtime-bridge/src/providers/ama.ts`) to the cloud turn
driver; decouple the loop from the Sandbox so the cloud loop **dispatches tool
execution to a Sandbox that may be the Cloudflare `Sandbox` or a self-hosted
runner-sandbox** (for `ama`, the runner becomes a dispatched sandbox host, not a
loop host). `ama` events are written to the `Session` DO store regardless of
Sandbox location. CLI runtimes keep their local loop unchanged.
- Gate: the Phase 1 server gates stay green; an `ama` session runs end to end
  with (a) a Cloudflare Sandbox and (b) a self-hosted runner-sandbox, both
  rendering events from the cloud store.

**Phase 2 — Frame schemas + SDK** (any-managed-agents). Declare the WebSocket
frame messages as OpenAPI `components.schemas` (`SessionEvent` reused,
`SessionBackfillResponse`, the `SessionClientFrame` discriminated union of
`prompt`/`abort`/`steer`/`approval`, `SessionRunnerUnavailable`); run
`pnpm run openapi:generate` to regenerate all three SDKs; add the typed
`client.sessions.stream()` (events async-iterable + `send` + `backfill`) to the
facade, typed against generated schemas.
- Gate: `pnpm run openapi:check` deterministic (clean tree); `pnpm --filter
  @any-managed-agents/sdk run typecheck && pnpm --filter @any-managed-agents/sdk
  run smoke` green. Commit + push; record the new SDK commit SHA.

**Phase 3 — AK integration** (agent-kanban). Bump `apps/web` SDK pin to the new
SHA + `pnpm install`; add the stateful converter `createAmaEventAdapter()` in
`packages/shared` (`AmaSessionEvent → AgentEvent[]`, correlating
`message_*`/`tool_execution_*` by `correlationId`/`sequence` per the mapping in
*SDK & client integration* and the renderer's `AgentEvent` union); replace
`ChatPanel`'s `LIVE_POLL_MS` polling with `client.sessions.stream()`; branch
`ChatPanel` on `ama.sessionId` (present → `AmaRuntimeProvider`/stream; absent →
the surviving `RelayRuntimeProvider`/legacy tunnel, per *Backward
compatibility*); surface (at minimum pass through) `permission.request` /
`policy.decision`.
- Gate: `pnpm build && pnpm typecheck && npx vitest run` all green. Test changes
  go through the test agents.

## Constraints

- SDKs are generated by the community tools only (hey-api / oapi-codegen /
  openapi-python-client). Never hand-roll a generator or hand-edit the OpenAPI;
  what codegen cannot express (WebSocket transport) is hand-written only in the
  facade.
- One logical change per commit. Server work branches off merged `main`; AK work
  stays on `codex/ama-runtime-integration`.
- A red gate stops progress — fix it, do not stack on top. If genuinely blocked
  (missing credentials, a decision only the owner can make), stop and report;
  do not hack around it.
- Do not change code unrelated to this requirement.

## Acceptance criteria

**Final gate: one server, both client versions, both sessions visible.** The
session-event + relay migration is accepted only when a smoke test drives the
deployed (new) server with **both a new-version and an old-version `ak` CLI at
the same time**, and both sessions render in the web UI:

1. **New `ak`** (AMA runner): claim + run a task → its session renders in the web
   chat via the AMA path (`Session` DO / `stream()` / snapshot).
2. **Old `ak`** (legacy daemon, un-upgraded binary): claim + run a task → its
   live session renders in the web chat via the legacy tunnel
   (`/api/tunnel/ws` + `TunnelRelay` + `RelayRuntimeProvider`).
3. **Concurrency**: both tasks' event streams render correctly and at the same
   time — neither blanks the other; opening each task's detail shows that task's
   own transcript.

The smoke harness must pin and launch two `ak` versions (the current build and
the last pre-AMA published version) against a single server and assert rendered
events for each. This dual-version smoke is the final acceptance gate.

## Open questions

- Archive trigger & DO warm-retention for recently-ended sessions to avoid R2
  round-trips on a quick re-open.
- WebSocket frame protocol: message envelope, ordering/acks for inbound prompts,
  and reconnect/resume (resume from last-seen `sequence`).
- Runner local-store retention/eviction (disk pressure) — per-session vs rolling
  window.
- Opaque cursor portable across both stores (encodes `sequence`) so the browser
  cannot tell which backend served a page.
- Multi-runner / re-bind: a session's data is pinned to the machine that ran it;
  document that re-homing is unsupported (data does not migrate).
