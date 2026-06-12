# Cloudflare Deployment

GitHub Actions is intentionally limited to CI checks. Production and staging deploys should run through Cloudflare's own build and deploy pipeline.

## Required Cloudflare resources

- Workers project: `any-managed-agents`
- Workers AI binding: `AI`
- Cloudflare Sandbox container binding: `SANDBOX`
- Production D1 database: `any-managed-agents-db`
- Staging D1 database: `any-managed-agents-db-staging`
- Container image built from this repository's `Dockerfile`

## OIDC Provider

Create one OIDC application for each deployed Worker host.

Required settings:

- Issuer: `OIDC_ISSUER`
- Client id: `OIDC_CLIENT_ID`
- Client secret: store as Wrangler secret `OIDC_CLIENT_SECRET`
- Redirect URI: configure in the OIDC provider as `https://<worker-host>/auth/callback`
- Scopes: `openid email profile`
- Flow: authorization code with PKCE

The browser uses the community `oidc-client-ts` library for authorization-code
PKCE redirect handling. The Worker uses the community `openid-client` library for
discovery and userinfo retrieval from OIDC bearer tokens. Do not implement
OIDC parsing or token validation by hand.

Control-plane settings:

- `AMA_ALLOWED_ORIGINS`: comma-separated browser origins allowed for credentialed
  CORS requests.

## Sandbox tool executor

Each AMA session owns one Cloudflare Sandbox instance as a tool executor backend.
AMA cloud-side code owns the session loop and dispatches concrete tool execution
requests to the sandbox. The sandbox runs commands and file operations in
`/workspace`; it does not run the primary Pi/PyAgent process for the session.

The container image must be built from this repository's `Dockerfile`. Runtime
packages required for tool execution must be baked into the container image. The
runtime must not install Node packages during session start; session startup
should only create workspace metadata and initialize the executor backend.

Required Worker bindings and variables:

- `SANDBOX`: Cloudflare Sandbox/Containers binding.
- `AMA_RUNTIME_MODE=live` for deployed environments. Tests use
  `AMA_RUNTIME_MODE=test`.
- `AMA_PI_BRIDGE_PORT` and `AMA_PI_BRIDGE_COMMAND`: legacy bridge-only settings.
  They are not used by the normal v1 cloud-owned runtime path.

## Workers AI model configuration

v1.0 keeps model and provider policy in AMA before runtime work starts. The
cloud-owned runtime calls provider adapters from the Worker side. The sandbox
does not call the Cloudflare REST API directly for model work.

Required settings:

- `AMA_DEFAULT_MODEL=@cf/moonshotai/kimi-k2.6`
- `AMA_WORKERS_AI_ACCOUNT_ID=<cloudflare-account-id>`
- `AMA_RUNTIME_AI_PROXY_TOKEN`: legacy bridge-only secret. It is not required by
  the normal cloud-owned runtime path.
- `AMA_AI_GATEWAY_ID`: optional Cloudflare AI Gateway id

Do not store raw provider credentials in D1, session events, UI state, or logs.
The database may store metadata and secret references only.

## Vault credential encryption

Vault credential storage encrypts managed secret values (the `ama-managed` and
`cloudflare-secrets` providers) with AES-GCM before anything reaches D1.

Required settings:

- `AMA_VAULT_ENCRYPTION_KEY`: store as a Wrangler secret with at least 32
  characters. Credential creation and rotation fail fast when it is missing;
  there is no fallback to `AMA_SESSION_SECRET`.

Rotating this key invalidates existing ciphertext, so plan a credential
rotation pass when the key changes. Tampered or foreign ciphertext is rejected
with a safe error during runtime resolution.

## Self-hosted runners

Self-hosted runners service environments with `hostingMode: "self_hosted"` and
an explicit selected `runtime`. They claim queued work from
`/api/runners/{runnerId}/leases`, renew the lease while executing, upload
canonical AMA session events, and complete, fail, or cancel the lease.

Runner authentication material must live in Cloudflare Secrets or an approved
external vault. D1 stores runner metadata, capabilities, heartbeat/load state,
work item payloads, lease state, safe result/error metadata, and secret
references only. Do not expose runner host ports, runner-local preview URLs, or
runner-local filesystem paths as product endpoints.

## Local E2E And Staging Smoke

Run browser e2e against the local dev server in local development and CI. This
path must not consume real model quota or depend on deployed origins:

```bash
pnpm run test:e2e
```

After deploying staging, run the real runtime smoke against the staging origin:

```bash
AMA_STAGING_ORIGIN=https://any-managed-agents-staging.saltbo.workers.dev \
AMA_E2E_ACCESS_TOKEN="$OIDC_ACCESS_TOKEN" \
pnpm run test:smoke
```

`AMA_STAGING_ORIGIN` defaults to the staging Workers host. Auth input precedence is
explicit: `AMA_E2E_ACCESS_TOKEN` is used first, `AMA_E2E_STORAGE_STATE` second, and
`AMA_E2E_EMAIL` plus `AMA_E2E_PASSWORD` third. Set only one auth method in CI
unless intentionally overriding a lower precedence method.

- `AMA_E2E_ACCESS_TOKEN`: a OIDC provider-issued OIDC access token.
- `AMA_E2E_STORAGE_STATE`: Playwright storage state from a real OIDC provider login.
  The documented `.secrets/` directory is ignored by git.
- `AMA_E2E_EMAIL` and `AMA_E2E_PASSWORD`: credentials for the browser login
  flow.

The staging smoke never queries or mutates auth databases. It verifies
`/api/projects`, creates an environment, agent, and session through public `/api`
routes, opens the session detail page, sends multiple runtime messages through
the UI/WebSocket, checks transcript, tool, debug error, and reload dedupe
behavior, then archives the smoke resources. Keep the access token or storage state in
the CI secret manager, write it only to an ignored runtime path, and avoid
printing it in logs. Do not run this as the default e2e path because session
startup may consume runtime and model quota.

## Cloudflare build settings

Use these settings when connecting the GitHub repository in Cloudflare:

- Production build command: `pnpm run build`
- Staging build command: `pnpm run build:staging`
- Deploy command: managed by Cloudflare Workers Builds
- Root directory: repository root
- Production branch: `master`

Database migrations are explicit and should be run before deploy promotion:

```bash
pnpm run db:migrate:d1:staging
pnpm run db:migrate:d1:prod
```

## Durable Object migration bootstrap

Cloudflare Workers Builds deploys with `wrangler versions upload`. The first deployment that introduces a Durable Object migration cannot use version upload; Cloudflare requires the migration to be applied through a non-versioned deployment first.

For a brand-new Worker, run this once after creating D1 resources and before relying on Workers Builds:

```bash
pnpm run build
pnpm exec wrangler deploy
```

After that bootstrap deployment, Workers Builds can upload new versions normally.

GitHub Actions must not be granted Cloudflare deployment credentials unless this policy changes.
