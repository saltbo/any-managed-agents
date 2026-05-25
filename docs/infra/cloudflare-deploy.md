# Cloudflare Deployment

GitHub Actions is intentionally limited to CI checks. Production and staging deploys should run through Cloudflare's own build and deploy pipeline.

## Required Cloudflare resources

- Workers project: `any-managed-agents`
- Workers AI binding: `AI`
- Durable Object binding: `MANAGED_AGENT`
- Cloudflare Sandbox container binding: `SANDBOX`
- Production D1 database: `any-managed-agents-db`
- Staging D1 database: `any-managed-agents-db-staging`
- Container image built from this repository's `Dockerfile`

## FlareAuth OIDC

Create one FlareAuth OIDC application for each deployed Worker host.

Required settings:

- Issuer: `FLAREAUTH_ISSUER`
- Client id: `FLAREAUTH_CLIENT_ID`
- Client secret: store as Wrangler secret `FLAREAUTH_CLIENT_SECRET`
- Redirect URI: `FLAREAUTH_REDIRECT_URI`, set to
  `https://<worker-host>/api/auth/callback`
- Scopes: `openid email profile`
- Flow: authorization code with PKCE

The Worker uses the community `openid-client` library for discovery, PKCE,
callback exchange, and userinfo retrieval. Do not implement OIDC parsing or
token validation by hand.

Session settings:

- `AMA_SESSION_SECRET`: 32 bytes or stronger random secret, stored with Wrangler
  secrets.
- `AMA_COOKIE_SECURE=true` for deployed environments.
- `AMA_COOKIE_SAME_SITE=Lax` unless the deployment requires cross-site embedding.
- `AMA_ALLOWED_ORIGINS`: comma-separated browser origins allowed for credentialed
  CORS requests.

## Sandbox and Pi runtime

Each AMA session starts one Cloudflare Sandbox instance and launches
`server/runtime/pi/pi-bridge.mjs` inside that container. The bridge starts Pi in
RPC mode and exposes `/health` and `/rpc` on `AMA_PI_BRIDGE_PORT`.

The container image must be built from this repository's `Dockerfile`. Runtime
packages, including `@earendil-works/pi-coding-agent`, must be baked into the container image. The runtime must not install npm packages during session start; session
startup should only create workspace metadata and launch the already-installed
Pi bridge.

Required Worker bindings and variables:

- `SANDBOX`: Cloudflare Sandbox/Containers binding.
- `AMA_PI_BRIDGE_PORT`: bridge port, default `8788`.
- `AMA_RUNTIME_MODE=live` for deployed environments. Tests use
  `AMA_RUNTIME_MODE=test`.
- `AMA_PI_BRIDGE_COMMAND`: optional override for the bridge command.

## Workers AI model configuration

v1.0 passes model work from Pi to Cloudflare Workers AI through Pi's
`cloudflare-workers-ai` provider. AMA stores provider/model policy on agent
versions and maps the external AMA provider name `workers-ai` to Pi's provider
name when launching the runtime. The sandbox does not call the Cloudflare REST
API directly. AMA writes a Pi `models.json` override so Pi sends OpenAI-compatible
chat completion requests to AMA's runtime Workers AI proxy, and the Worker calls
Workers AI through the `AI` binding.

Required settings:

- `AMA_DEFAULT_MODEL=@cf/moonshotai/kimi-k2.6`
- `AMA_WORKERS_AI_ACCOUNT_ID=<cloudflare-account-id>`
- `AMA_RUNTIME_AI_PROXY_TOKEN`: Wrangler secret used only between the sandbox
  Pi process and AMA's `/api/runtime/workers-ai/v1/chat/completions` proxy.
- `AMA_AI_GATEWAY_ID`: optional Cloudflare AI Gateway id

Do not store raw provider credentials in D1, session events, UI state, or logs.
The database may store metadata and secret references only.

## Cloudflare build settings

Use these settings when connecting the GitHub repository in Cloudflare:

- Production build command: `npm run build`
- Staging build command: `npm run build:staging`
- Deploy command: managed by Cloudflare Workers Builds
- Root directory: repository root
- Production branch: `master`

Database migrations are explicit and should be run before deploy promotion:

```bash
npm run db:migrate:d1:staging
npm run db:migrate:d1:prod
```

## Durable Object migration bootstrap

Cloudflare Workers Builds deploys with `wrangler versions upload`. The first deployment that introduces a Durable Object migration cannot use version upload; Cloudflare requires the migration to be applied through a non-versioned deployment first.

For a brand-new Worker, run this once after creating D1 resources and before relying on Workers Builds:

```bash
npm run build
npx wrangler deploy
```

After that bootstrap deployment, Workers Builds can upload new versions normally.

GitHub Actions must not be granted Cloudflare deployment credentials unless this policy changes.
