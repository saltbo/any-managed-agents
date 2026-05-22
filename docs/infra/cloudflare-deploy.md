# Cloudflare Deployment

GitHub Actions is intentionally limited to CI checks. Production and staging deploys should run through Cloudflare's own build and deploy pipeline.

## Required Cloudflare resources

- Workers project: `any-managed-agents`
- Workers AI binding: `AI`
- Durable Object binding: `MANAGED_AGENT`
- Production D1 database: `any-managed-agents-db`
- Staging D1 database: `any-managed-agents-db-staging`

Replace the placeholder D1 `database_id` values in `wrangler.toml` after creating the databases.

## Cloudflare build settings

Use these settings when connecting the GitHub repository in Cloudflare:

- Build command: `npm run build`
- Deploy command: managed by Cloudflare Workers Builds
- Root directory: repository root
- Production branch: `master`

Database migrations are explicit and should be run before deploy promotion:

```bash
npm run db:migrate:d1:staging
npm run db:migrate:d1:prod
```

GitHub Actions must not be granted Cloudflare deployment credentials unless this policy changes.
