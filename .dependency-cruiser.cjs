/**
 * Architecture enforcement for the hono-cf-clean-arch layout.
 *   pnpm lint:arch  →  depcruise server/ shared/ --config .dependency-cruiser.cjs
 *
 * The clean core is domain/ → usecases/ → adapters/ ← http/. Those rules are
 * strict. A handful of env-bound infrastructure modules legitimately touch
 * persistence outside adapters/repos and are named exceptions on the drizzle
 * rule (the skill's "a few stragglers" — here the runtime execution engine is
 * the big one):
 *   - server/auth      OIDC/session auth module: owns its tables, is the auth
 *                      wall, spans layers by design.
 *   - server/runtime   the env-bound session/runtime execution engine (sandbox,
 *                      durable objects, drivers); wrapped by gateways.
 *   - server/policy.ts cross-cutting policy engine, wrapped by PolicyPort.
 *   - server/audit.ts  the audit writer wrapped by AuditPort.
 *   - server/schedules background trigger dispatcher (cron/queue entry).
 *   - server/providers provider adapter helpers (catalog mapping, usage).
 *   - server/composition.ts the composition root constructs the db.
 *   - server/app.ts    composition consumer + the exempt /runtime data-plane
 *                      proxy (non-REST protocol surface).
 *   - server/routes    leftover exempt surfaces: e2e fixtures, the workers-ai
 *                      protocol endpoint, shared zod contracts, health.
 */

const INFRA = '^server/(auth|runtime|schedules|providers|routes)|^server/(policy|audit|composition|app)\\.ts'

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-stays-pure',
      comment: 'domain/ may only import domain/ and shared/. No frameworks, no I/O.',
      severity: 'error',
      from: { path: '^server/domain' },
      to: { pathNot: '^server/domain|^shared' },
    },
    {
      name: 'usecases-no-infrastructure',
      comment: 'usecases/ must not reach outward to adapters, http, db, or composition.',
      severity: 'error',
      from: { path: '^server/usecases' },
      to: { path: '^server/(adapters|http|db)|^server/composition' },
    },
    {
      name: 'usecases-no-framework-packages',
      comment: 'usecases/ must not import delivery or persistence frameworks.',
      severity: 'error',
      from: { path: '^server/usecases' },
      to: { path: 'node_modules/(hono|drizzle-orm)|@hono/' },
    },
    {
      name: 'adapters-not-into-delivery',
      comment: 'adapters/ implement ports; they never know about http/ or composition.',
      severity: 'error',
      from: { path: '^server/adapters' },
      to: { path: '^server/(http|composition)' },
    },
    {
      name: 'drizzle-stays-in-persistence',
      comment: 'Persistence is confined to adapters/ (repos + gateways that hold a db handle), db/, and the named env-bound infrastructure modules.',
      severity: 'error',
      from: { path: '^server', pathNot: `^server/(adapters|db)|${INFRA}` },
      to: { path: 'node_modules/drizzle-orm|^server/db/schema' },
    },
    {
      name: 'http-not-into-adapters',
      comment: 'http/ gets dependencies from context, never constructs adapters.',
      severity: 'error',
      from: { path: '^server/http' },
      to: { path: '^server/adapters' },
    },
    {
      name: 'shared-is-a-leaf',
      comment: 'shared/ is the contract; it imports nothing from server/ or src/.',
      severity: 'error',
      from: { path: '^shared' },
      to: { path: '^server|^src' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['\\.(test|spec)\\.[jt]sx?$', '\\.gen\\.[jt]s$', 'server/worker-configuration'] },
    tsConfig: { fileName: 'tsconfig.server.json' },
    tsPreCompilationDeps: true,
  },
}
