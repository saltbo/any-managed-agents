import { swaggerUI } from '@hono/swagger-ui'
import { cors } from 'hono/cors'
import { createDeps } from './composition'
import type { Env } from './env'
import { registerAccessRuleRoutes } from './http/access-rules'
import { registerAgentRoutes } from './http/agents'
import { registerAuditRecordRoutes } from './http/audit-records'
import { registerAuthRoutes } from './http/auth'
import { registerBudgetRoutes } from './http/budgets'
import { registerConnectionRoutes } from './http/connections'
import { registerConnectorRoutes } from './http/connectors'
import e2e from './http/e2e'
import { registerEffectivePolicyRoutes } from './http/effective-policy'
import { registerEnvironmentRoutes } from './http/environments'
import { registerFederatedTenantRoutes } from './http/federated-tenants'
import health from './http/health'
import { registerLeaseRoutes } from './http/leases'
import { registerPolicyRoutes } from './http/policies'
import { registerProjectRoutes } from './http/projects'
import { registerProviderRoutes } from './http/providers'
import { registerRunnerRoutes } from './http/runners'
import runtimeAi from './http/runtime-ai'
import { registerRuntimeProxy } from './http/runtime-proxy'
import { registerRuntimeRoutes } from './http/runtimes'
import { registerSessionRoutes } from './http/sessions'
import { registerTriggerRoutes } from './http/triggers'
import { registerUsageRecordRoutes } from './http/usage-records'
import { registerUsageSummaryRoutes } from './http/usage-summary'
import { registerVaultRoutes } from './http/vaults'
import { registerWorkItemRoutes } from './http/work-items'
import { ApiSecuritySchemes, createDepsApiRouter } from './openapi'

export function createApp() {
  const app = createDepsApiRouter()

  // Deps injection registers first: it guards nothing, it only makes the
  // composition-root Deps object available to every route via c.get('deps').
  app.use('*', (c, next) => {
    c.set('deps', createDeps(c.env))
    return next()
  })

  app.use(
    '/*',
    cors({
      origin: (origin, c) => {
        // hono's cors() erases the binding type on c, so env reads as `any`
        // here; re-attach the worker Env to keep the read type-checked.
        const allowedOrigins = (c.env as Env).AMA_ALLOWED_ORIGINS
        if (!allowedOrigins) {
          return null
        }
        return allowedOrigins.split(',').includes(origin) ? origin : null
      },
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-AMA-Project-ID'],
      credentials: true,
    }),
  )

  // Every control-plane resource lives under /api/v1. Auth and its federation
  // config are the one namespaced area (the IdP boundary; also disambiguates
  // login sessions from agent /sessions). The two /api/v1/runtime routes are
  // protocol-adapter endpoints: their wire shape is dictated by external
  // protocols (ACP tunnel, OpenAI-compatible inference) and is therefore
  // exempt from REST resource modeling (docs/api-v1-design.md §1.8).
  // agents, environments, providers, vaults, connectors, connections, the
  // governance resources, and the usage/audit reporting resources are migrated
  // to the clean-architecture http layer. Each registers its OpenAPI
  // routes (load-bearing internal order: static before parameter segments) onto
  // a sub-router mounted at the resource's original chain position, so the
  // assembled route order and AppType stay identical.
  const auth = registerAuthRoutes(createDepsApiRouter())
  const federatedTenants = registerFederatedTenantRoutes(createDepsApiRouter())
  const projects = registerProjectRoutes(createDepsApiRouter())
  const triggers = registerTriggerRoutes(createDepsApiRouter())
  const agents = registerAgentRoutes(createDepsApiRouter())
  const environments = registerEnvironmentRoutes(createDepsApiRouter())
  const providers = registerProviderRoutes(createDepsApiRouter())
  const runners = registerRunnerRoutes(createDepsApiRouter())
  const workItems = registerWorkItemRoutes(createDepsApiRouter())
  const leases = registerLeaseRoutes(createDepsApiRouter())
  const connectors = registerConnectorRoutes(createDepsApiRouter())
  const connections = registerConnectionRoutes(createDepsApiRouter())
  const policies = registerPolicyRoutes(createDepsApiRouter())
  const effectivePolicy = registerEffectivePolicyRoutes(createDepsApiRouter())
  const accessRules = registerAccessRuleRoutes(createDepsApiRouter())
  const budgets = registerBudgetRoutes(createDepsApiRouter())
  const usageRecords = registerUsageRecordRoutes(createDepsApiRouter())
  const usageSummary = registerUsageSummaryRoutes(createDepsApiRouter())
  const auditRecords = registerAuditRecordRoutes(createDepsApiRouter())
  const sessionsRoutes = registerSessionRoutes(createDepsApiRouter())
  const vaults = registerVaultRoutes(createDepsApiRouter())
  const runtimes = registerRuntimeRoutes(createDepsApiRouter())

  const routes = app
    .route('/api/v1/health', health)
    .route('/api/v1/e2e', e2e)
    .route('/api/v1/auth/federated-tenants', federatedTenants)
    .route('/api/v1/auth', auth)
    .route('/api/v1/projects', projects)
    .route('/api/v1/agents', agents)
    .route('/api/v1/environments', environments)
    .route('/api/v1/providers', providers)
    .route('/api/v1/runtime', runtimeAi)
    .route('/api/v1/runtimes', runtimes)
    .route('/api/v1/runners', runners)
    .route('/api/v1/work-items', workItems)
    .route('/api/v1/leases', leases)
    .route('/api/v1/policies', policies)
    .route('/api/v1/effective-policy', effectivePolicy)
    .route('/api/v1/access-rules', accessRules)
    .route('/api/v1/budgets', budgets)
    .route('/api/v1/connectors', connectors)
    .route('/api/v1/connections', connections)
    .route('/api/v1/usage-records', usageRecords)
    .route('/api/v1/usage-summary', usageSummary)
    .route('/api/v1/audit-records', auditRecords)
    .route('/api/v1/triggers', triggers)
    .route('/api/v1/sessions', sessionsRoutes)
    .route('/api/v1/vaults', vaults)

  routes.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', ApiSecuritySchemes.bearerAuth)

  routes.doc('/api/v1/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'Any Managed Agents API',
      version: '1.0.0',
      description:
        'Control-plane API for Any Managed Agents. Every resource lives under /api/v1 and follows REST conventions. Command-line automation uses restish or direct HTTP against this OpenAPI document; runtime traffic flows through the /api/v1/runtime protocol-adapter endpoints and canonical session events.',
    },
    servers: [{ url: '/' }],
  })

  routes.get('/api/v1/docs', swaggerUI({ url: '/api/v1/openapi.json' }))

  // The runtime data-plane proxy mounts after the typed /api/v1/runtime
  // sub-router so its catch-all only matches the session protocol paths.
  registerRuntimeProxy(routes)

  routes.notFound((c) => c.json({ error: { type: 'not_found', message: 'Not found' } }, 404))

  routes.onError((err, c) => {
    console.error(err)
    return c.json({ error: { type: 'internal_error', message: 'Internal server error' } }, 500)
  })

  return routes
}

export type AppType = ReturnType<typeof createApp>
