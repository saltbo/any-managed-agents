# Production Acceptance - 2026-05-25

Task: `iwkhnnm8ys1y`

## Source Round

Production acceptance was run from `ak/e29090cb` at commit
`efa8abfedab042cba65ce36a46fbc1f161209349`.

Merged hardening PRs pulled into this round:

- #19 Land console layout and session detail hardening
- #20 Harden session event pagination and replay
- #21 Add production e2e regression harness
- #22 Enforce sandbox runtime policy and event redaction
- #23 Add Pi event alignment gates

## Production Deploy

Command:

```bash
npm run deploy
```

Result:

- D1 production migrations: no migrations to apply.
- Worker: `any-managed-agents`
- Production origin: `https://ama.tftt.cc`
- Worker version id: `0e50e48c-842e-4787-b7d6-7eb988c83b9e`
- Wrangler version number: `171`
- Container image: `registry.cloudflare.com/94a89d03c0fc785c8dcbd3c674d6742a/ama-pi-runtime:0.75.4-ama.3`
- Container deploy: no changes for `any-managed-agents-sandbox`
- Asset upload: no updated asset files to upload
- Client asset ids:
  - `/assets/index-D-7G9xuU.js`
  - `/assets/index-C9xtp4U7.css`
  - `/assets/geist-cyrillic-wght-normal-CHSlOQsW.woff2`
  - `/assets/geist-latin-ext-wght-normal-DMtmJ5ZE.woff2`
  - `/assets/geist-latin-wght-normal-Dm3htQBi.woff2`
- Worker module assets:
  - `assets/worker-entry-CG9M7YEu.js`
  - `assets/mimetext.node.es-D0p8SOBW.js`

Production health:

```bash
curl -fsS -D - https://ama.tftt.cc/api/health -o /tmp/ama-health.json
```

Returned HTTP 200 with `{"status":"ok","name":"Any Managed Agents","runtime":"cloudflare-workers"}`.

## Verification Commands

Passed:

```bash
npm ci
npm run lint
npm run typecheck
npm run test
npm run bdd
npm run bdd:e2e
npm run test:cf
npm run build
npm run smoke:restish
npx vitest run src/features/sessions/pi-runtime.test.ts src/features/sessions/sessions-ui.test.tsx
```

Observed counts:

- `npm run test`: 7 files, 43 tests passed.
- `npm run bdd`: 131 scenarios, 561 steps passed.
- `npm run bdd:e2e`: 2 scenarios, 15 steps passed.
- `npm run test:cf`: 12 files, 61 tests passed.
- Focused session tests: 2 files, 24 tests passed.

Build produced non-fatal Vite warnings for large chunks and static/dynamic import overlap.
`test:cf` produced non-fatal workerd sourcemap and WebSocket disconnect noise.
`npm ci` reported existing moderate npm audit findings.

Coverage status:

- Overall automated code coverage was not measured in this release gate.
- Critical browser journey coverage is blocked because the real authenticated
  production journey was skipped.
- The local mocked browser and focused unit coverage passed, but it does not
  replace real production journey evidence.

## Production E2E Blocker

Command:

```bash
AMA_ORIGIN=https://ama.tftt.cc npm run e2e:production
```

Result: the single production regression test was skipped because no usable auth
material was available to the command.

Credential reconciliation:

- Initial local checks found no `.secrets/ama-storage-state.json` and no
  `AMA_E2E_COOKIE`, `AMA_E2E_EMAIL`, or `AMA_E2E_PASSWORD` in the process
  environment.
- A later leader note stated that `.secrets/ama-e2e-env.sh` had been created
  with dedicated production e2e credentials and should be sourced before running
  production e2e.
- Rechecking this worktree found `.secrets/ama-e2e-env.sh` missing, and
  `find .secrets -maxdepth 2 -type f` returned no files.

When credentials are available, the existing production regression harness
authenticates, creates environment/agent/session resources through public APIs,
drives the session UI/WebSocket, checks transcript/tool/debug/error rendering,
and verifies reconnect dedupe. This run did not prove that journey because auth
could not be established.

The required 20-turn chat and `whoami` production evidence was not attempted
successfully. The current harness also remains narrower than the requested
acceptance because it uses three prompts, `printf ama-tool-ok`, API-created
resources, and debug-visible error text rather than UI login, UI-created session,
20 sequential `whoami` turns, tooltip/details, and sessions table layout checks.

## Remaining Gap Plan

Created next-round planning task `p0h1h15mmhej` for the remaining P1/P2 gaps:

- Secure production or staging authenticated e2e credential path for CI and agents.
- Real browser login evidence instead of only storage/cookie reuse.
- UI-driven create-session production journey.
- 20 sequential chat/tool turns with `whoami` rendering.
- Production error tooltip/detail verification.
- Desktop and 390px mobile sessions table/session layout verification.
- Release checklist updates for deploy identifiers and auth prerequisites.
- Triage of npm audit moderate findings and bundle-size warnings.
