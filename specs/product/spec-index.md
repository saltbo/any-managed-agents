# Product Spec Index

The product specs describe the intended end state for Any Managed Agents. Files tagged `@planned` are accepted target behavior and are excluded from the default executable BDD run until implementation begins.

This directory covers managed-agents capability areas as clean-room Any Managed Agents specs. Coverage is by product capability, not by copying another project's file layout. Cloudflare Workers, AMA cloud-owned runtime state, Cloudflare Sandbox executors, D1, Durable Objects, and Workers AI are architectural constraints.

This repository publishes the OpenAPI contract for product resources. Generated language SDK scaffolds live under `sdk/` and stay mechanically aligned with the Hono-generated OpenAPI document. AMA runtime endpoints are the v1.0 runtime protocol surface, and Cloudflare Sandbox remains the sandbox execution foundation.

## Core Platform

- `control-plane.feature` - currently implemented control-plane health behavior
- `auth-tenancy.feature` - authentication, organization, project, and user context
- `auth.feature`, `auth-flow.feature`, `auth-guard.feature`, `login.feature`, `login-page.feature`, `sso-discovery.feature`, `user-initial-password.feature`, `web-auth-redirect.feature` - authentication and login coverage

## Managed Agent Model

- `agents-control-plane.feature` - agent definitions, versions, validation, and archive behavior
- `agent-builder.feature` - guided UI for creating and testing agents
- `agent-detail.feature`, `agents-api.feature`, `agents-ui.feature`, `agents-update.feature` - agent API and UI coverage
- `sessions-runtime.feature` - session lifecycle and AMA runtime endpoint behavior
- `session-detail-tool-tracing.feature`, `session-stop.feature`, `sessions-api.feature`, `sessions-events.feature`, `sessions-list-bulk-archive.feature`, `sessions-ui.feature` - session coverage

## Execution

- `environments.feature` - long-lived environment descriptions
- `environment-detail.feature`, `environments-api.feature`, `environments-mcp.feature`, `environments-ui.feature` - environment coverage
- `sandbox-execution.feature` - per-session Cloudflare Sandbox execution, files, commands, lifecycle, and policy
- `tools-mcp.feature` - tool configuration, MCP discovery, approval, and runtime enforcement
- `engine-cooperative-cancellation.feature`, `engine-error-termination.feature`, `engine-mcp.feature`, `engine-mcp-e2e.feature` - runtime engine coverage
- `mcp-client.feature`, `mcp-client-integration.feature`, `mcp-connections.feature`, `mcp-discovery.feature`, `mcp-policy-enforcement.feature` - MCP coverage

## Operations

- `providers-models.feature` - Workers AI and all configured provider support
- `provider-access.feature`, `providers.feature` - provider coverage
- `vault-secrets.feature` - Cloudflare Secrets references, redaction, rotation, and access control
- `vault-detail.feature`, `vaults.feature`, `vaults-api.feature`, `vaults-ui.feature` - vault coverage
- `governance-policy.feature` - policy hierarchy, budgets, and enforcement
- `governance-api.feature`, `governance-config.feature` - governance coverage
- `usage-audit.feature` - usage reporting and audit records
- `audit-auto.feature`, `audit-log-ui.feature`, `usage-summary.feature` - audit and usage coverage
- `api-contracts.feature`, `cli-openapi-contract.feature`, `web-api-client-consolidation.feature` - API and restish OpenAPI contract coverage
- `web-ui.feature` - web console navigation and resource workflows
- `layout.feature`, `list-date-range-filters.feature`, `list-route-pagination.feature` - UI infrastructure coverage
- `quickstart.feature` - first-run developer path
- `destructive-ops.feature`, `encryption.feature`, `integration-snippets.feature`, `storage-cloudflare-d1.feature` - operations, storage, and compatibility coverage
