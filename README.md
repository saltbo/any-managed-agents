# Any Managed Agents

[![CI](https://github.com/saltbo/any-managed-agents/actions/workflows/ci.yml/badge.svg)](https://github.com/saltbo/any-managed-agents/actions/workflows/ci.yml)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Cloudflare-native managed agents for any model, tool, and sandbox.

Any Managed Agents is an open, self-hostable managed agents platform designed to run on Cloudflare Workers. It is inspired by CMA and Claude Managed Agents, but it is not locked to Anthropic or any single model provider.

The platform owns the control plane for agents, environments, sessions, providers, policy, usage, and governance. This repository publishes the OpenAPI contract for that control plane; language SDKs are generated and maintained in separate repositories. v1.0 runtime traffic uses Pi protocol directly or through a transparent AMA proxy to Pi running inside a per-session Cloudflare Sandbox.

## Features

- Deploys to Cloudflare Workers
- Publishes OpenAPI documentation for external SDK generation
- Generates OpenAPI documentation from Hono route schemas
- Runs Pi coding agent inside per-session Cloudflare Sandbox
- Uses D1 and Durable Objects for Cloudflare-native state
- Supports Workers AI as a first-class model provider
- Supports all configured model providers through provider adapters
- Keeps product behavior in executable BDD specs
- Ships with GitHub CI and Cloudflare Workers Builds support

## Status

This project is early-stage. The current repository contains the Cloudflare runtime foundation, control-plane skeleton, executable platform specs, and deployment pipeline setup.

## Quick Start

Requirements:

- Node.js 24+
- npm
- Cloudflare account and Wrangler login for deployment
- FlareAuth OIDC application for login
- Cloudflare Sandbox/Containers access for Pi runtime sessions

```bash
git clone https://github.com/saltbo/any-managed-agents.git
cd any-managed-agents
npm install
cp .env.example .env
npm run dev
```

For local API checks, configure the FlareAuth issuer/client values, a random
`AMA_SESSION_SECRET`, and Workers AI account settings. The v1 runtime uses Pi in
a Cloudflare Sandbox container and the Pi Cloudflare provider name
`cloudflare-workers-ai`; the default model is `@cf/moonshotai/kimi-k2.6`.

Run the checks:

```bash
npm run lint
npm run typecheck
npm test
npm run bdd
npm run test:cf
npm run build
```

## Real Production E2E

The mocked browser e2e remains available for local UI coverage. A separate real
smoke path runs against `https://ama.tftt.cc` by default, or another deployed AMA
origin:

```bash
AMA_ORIGIN=https://ama.tftt.cc \
AMA_E2E_EMAIL="$AMA_E2E_EMAIL" \
AMA_E2E_PASSWORD="$AMA_E2E_PASSWORD" \
npm run e2e:production
```

Auth input precedence is explicit. The harness uses `AMA_E2E_COOKIE` first,
`AMA_E2E_STORAGE_STATE` second, and `AMA_E2E_EMAIL` plus `AMA_E2E_PASSWORD`
third. Set only one auth method in CI unless intentionally overriding a lower
precedence method.

- `AMA_E2E_COOKIE`: short-lived AMA session cookie value such as
  `__Host-ama_session=...`.
- `AMA_E2E_STORAGE_STATE`: short-lived Playwright storage state produced by a real
  FlareAuth login. This may be either the JSON storage state secret value or a
  path to a storage state file. The documented `.secrets/` directory is ignored
  by git for operator-only local runs.
- `AMA_E2E_EMAIL` and `AMA_E2E_PASSWORD`: durable credentials for the supported
  FlareAuth browser login flow. This is the preferred CI and agent-run path.

Use GitHub Actions environment secrets for CI and Agent Kanban secret injection
for agent runs. In GitHub Actions, create protected `production` and `staging`
environments and store the same generic secret names in each environment:
`AMA_E2E_EMAIL`, `AMA_E2E_PASSWORD`, and optionally `AMA_E2E_COOKIE` or
`AMA_E2E_STORAGE_STATE` for short-lived override runs. Set `AMA_ORIGIN` to the
matching deployment origin. If a central secret manager cannot scope secrets by
environment, use explicit source aliases such as `AMA_PRODUCTION_E2E_EMAIL` or
`AMA_STAGING_E2E_EMAIL` and map one environment's values into the generic
runtime variables before running `npm run e2e:production`.

The FlareAuth account behind these secrets must be a dedicated e2e user for the
matching environment, scoped to the least-privileged smoke-test organization or
project. It must not have administrator access. Rotate password and cookie or
storage-state material after any suspected exposure, after membership changes,
and at least quarterly. Cloudflare Worker secrets are not the approved transport
for browser e2e credentials because the Playwright runner, not the Worker,
consumes them.

Optional overrides are `AMA_E2E_PROVIDER` and `AMA_E2E_MODEL`; defaults target
Workers AI and `@cf/moonshotai/kimi-k2.6`. Playwright traces and videos are off
by default for this authenticated production config; set
`AMA_E2E_RECORD_ARTIFACTS=1` only for restricted local debugging and delete the
artifacts before sharing logs. The harness creates a test-safe environment,
agent, and session through public `/api` routes, drives chat through the session
UI/WebSocket, checks tool and error rendering, reloads the session, and archives
created resources during cleanup. Do not print, commit, paste into task notes, or
upload auth cookies, storage state, credentials, screenshots, videos, or traces
containing authenticated pages.

## Deployment

The project is configured for Cloudflare Workers. GitHub Actions only runs CI checks; deployment is handled by Cloudflare Workers Builds.

Before deploying v1.0, create the D1 databases, configure FlareAuth with
`/api/auth/callback`, set Wrangler secrets for `FLAREAUTH_CLIENT_SECRET`,
`AMA_SESSION_SECRET`, and `AMA_WORKERS_AI_API_KEY`, and build the Pi runtime
image from this repository's `Dockerfile`. Runtime dependencies must be baked
into that image; request-time npm installation is not part of the session path.

For a new Cloudflare Worker with Durable Objects, run one bootstrap deployment before relying on Workers Builds:

```bash
npm run build
npx wrangler deploy
```

See [docs/infra/cloudflare-deploy.md](docs/infra/cloudflare-deploy.md) for the full deployment notes.

## Project Layout

```txt
workers/          Cloudflare Worker entry
server/           Hono API, D1 schema, and platform services
src/              React app
migrations/       D1 migrations
specs/product/    Product behavior in Gherkin
test/bdd/         Cucumber step definitions
docs/             Product and infrastructure docs
```

## Documentation

- [Product spec](docs/product/spec.md)
- [Product decisions](docs/product/decisions.md)
- [SDK and API boundary](docs/product/sdk.md)
- [Cloudflare deployment](docs/infra/cloudflare-deploy.md)
- [Contributing guide](CONTRIBUTING.md)

## Contributing

Contributions should follow the BDD-first workflow: update product specs first, then implement, then verify.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Clean-Room Notice

This is a clean-room implementation. It is not a fork of any AGPL managed-agents project, and it does not copy source, specs, UI text, schemas, or implementation details from those projects.

## License

Apache-2.0
