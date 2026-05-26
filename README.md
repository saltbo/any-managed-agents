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
- OIDC application for login
- Cloudflare Sandbox/Containers access for Pi runtime sessions

```bash
git clone https://github.com/saltbo/any-managed-agents.git
cd any-managed-agents
npm install
cp .env.example .env
npm run dev
```

For local API checks, configure the OIDC provider issuer/client values, a random
`AMA_SESSION_SECRET`, and Workers AI account settings. The v1 runtime uses Pi in
a Cloudflare Sandbox container and the Pi Cloudflare provider name
`cloudflare-workers-ai`; the default model is `@cf/moonshotai/kimi-k2.6`.

Run the checks:

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Test script responsibilities:

- `npm test`: unit, component, route, and runtime tests, including Cloudflare Worker runtime tests.
- `npm run test:e2e`: local end-to-end acceptance, including Playwright browser coverage, implemented BDD specs, and the restish/OpenAPI path.
- `npm run test:smoke`: deployed staging smoke that may consume real runtime/model quota.

## Browser E2E And Staging Smoke

Browser e2e is a local-only check. It starts the local Vite/Worker dev server
and must not depend on deployed origins, real model quota, or production data:

```bash
npm run test:e2e
```

A separate staging smoke path can run against a deployed staging origin when the
runtime/model integration itself needs evidence:

```bash
AMA_STAGING_ORIGIN=https://any-managed-agents-staging.saltbo.workers.dev \
AMA_E2E_STORAGE_STATE=.secrets/ama-storage-state.json \
npm run test:smoke
```

Auth input precedence is explicit. The harness uses `AMA_E2E_COOKIE` first,
`AMA_E2E_STORAGE_STATE` second, and `AMA_E2E_EMAIL` plus `AMA_E2E_PASSWORD`
third. Set only one auth method in CI unless intentionally overriding a lower
precedence method.

- `AMA_E2E_COOKIE`: an AMA session cookie value such as
  `__Host-ama_session=...`.
- `AMA_E2E_STORAGE_STATE`: Playwright storage state produced by a real
  OIDC provider login. The documented `.secrets/` directory is ignored by git.
- `AMA_E2E_EMAIL` and `AMA_E2E_PASSWORD`: credentials for the supported
  OIDC provider browser login flow.

Optional staging-smoke overrides are `AMA_E2E_PROVIDER` and `AMA_E2E_MODEL`;
defaults target Workers AI and `@cf/moonshotai/kimi-k2.6`. The harness creates a test-safe
environment, agent, and session through public `/api` routes, drives chat through
the session UI/WebSocket, checks tool and error rendering, reloads the session,
and archives created resources during cleanup. In CI, store the storage state or
cookie in the secret manager and write it to an ignored path at runtime; do not
commit auth cookies, storage state, screenshots, videos, or traces.

## Deployment

The project is configured for Cloudflare Workers. GitHub Actions only runs CI checks; deployment is handled by Cloudflare Workers Builds.

Before deploying v1.0, create the D1 databases, configure OIDC provider with
`/api/auth/callback`, set Wrangler secrets for `OIDC_CLIENT_SECRET`,
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
test/e2e/         Cucumber step definitions and browser helpers
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
