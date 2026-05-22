# Cloudflare Deployment

GitHub Actions is intentionally limited to CI checks. Production and staging deploys should run through Cloudflare's own build and deploy pipeline.

## Required Cloudflare resources

- Workers project: `any-managed-agents`
- Workers AI binding: `AI`
- Durable Object binding: `MANAGED_AGENT`
- Production D1 database: `any-managed-agents-db`
- Staging D1 database: `any-managed-agents-db-staging`

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
