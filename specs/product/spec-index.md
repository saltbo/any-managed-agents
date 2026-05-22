# Product Spec Index

The product specs describe the intended end state for Any Managed Agents. Files tagged `@planned` are accepted target behavior and are excluded from the default executable BDD run until implementation begins.

This directory covers managed-agents capability areas as clean-room Any Managed Agents specs. Coverage is by product capability, not by copying another project's file layout. Cloudflare Workers, Cloudflare Agent SDK, Cloudflare Sandbox SDK, D1, Durable Objects, and Workers AI are architectural constraints.

The platform provides a thin Any Managed Agents SDK for product resources. Cloudflare Agent SDK remains the runtime protocol, and Cloudflare Sandbox SDK remains the sandbox execution foundation.

## Core Platform

- `platform-principles.feature` - Cloudflare-native platform boundaries and SDK ownership rules
- `control-plane.feature` - currently implemented control-plane health behavior
- `auth-tenancy.feature` - authentication, organization, project, and user context
- `auth.feature`, `auth-flow.feature`, `auth-guard.feature`, `login.feature`, `login-page.feature`, `sso-discovery.feature`, `user-initial-password.feature`, `web-auth-redirect.feature` - authentication and login coverage

## Managed Agent Model

- `agents-control-plane.feature` - agent definitions, versions, validation, and archive behavior
- `agent-builder.feature` - guided UI for creating and testing agents
- `agent-detail.feature`, `agents-api.feature`, `agents-ui.feature`, `agents-update.feature` - agent API and UI coverage
- `sessions-runtime.feature` - session lifecycle and Cloudflare Agent SDK runtime routing
- `events-streaming.feature` - transcript, debug, and event streaming behavior
- `session-detail.feature`, `session-detail-tool-tracing.feature`, `session-stop.feature`, `sessions-api.feature`, `sessions-events.feature`, `sessions-list-bulk-archive.feature`, `sessions-ui.feature` - session coverage

## Execution

- `environments.feature` - reusable sandbox environment definitions
- `environment-detail.feature`, `environments-api.feature`, `environments-mcp.feature`, `environments-ui.feature` - environment coverage
- `sandbox-execution.feature` - Cloudflare Sandbox SDK execution, files, commands, and policy
- `tools-mcp.feature` - tool configuration, MCP discovery, approval, and runtime enforcement
- `engine-cooperative-cancellation.feature`, `engine-error-termination.feature`, `engine-mcp.feature`, `engine-mcp-e2e.feature` - runtime engine coverage
- `mcp-client.feature`, `mcp-client-integration.feature`, `mcp-connections.feature`, `mcp-discovery.feature`, `mcp-policy-enforcement.feature` - MCP coverage

## Operations

- `providers-models.feature` - Workers AI and external provider support
- `provider-access.feature`, `providers.feature` - provider coverage
- `vault-secrets.feature` - secret storage, redaction, rotation, and access control
- `vault-detail.feature`, `vaults.feature`, `vaults-api.feature`, `vaults-ui.feature` - vault coverage
- `governance-policy.feature` - policy hierarchy, budgets, and enforcement
- `governance-api.feature`, `governance-config.feature` - governance coverage
- `usage-audit.feature` - usage reporting and audit records
- `audit-auto.feature`, `audit-log-ui.feature`, `usage-summary.feature` - audit and usage coverage
- `api-contracts.feature` - OpenAPI, product SDK, and error contracts for control-plane automation
- `openapi.feature`, `web-api-client-consolidation.feature` - API contract coverage
- `cli.feature`, `cli-client.feature`, `cli-contract.feature`, `cli-smoke-test.feature` - optional control-plane CLI coverage, not runtime SDK coverage
- `web-ui.feature` - web console navigation and resource workflows
- `layout.feature`, `list-date-range-filters.feature`, `list-route-pagination.feature` - UI infrastructure coverage
- `quickstart.feature` - first-run developer path
- `destructive-ops.feature`, `encryption.feature`, `integration-snippets.feature`, `scenario-tests.feature`, `server-tests.feature`, `ci-cloudflare-smoke.feature`, `storage-cloudflare-d1.feature` - operations, storage, and compatibility coverage
- `audit-action-alignment-lint.feature`, `event-badges-alignment-lint.feature`, `event-type-alignment-lint.feature`, `schema-handler-alignment-lint.feature`, `schemas-types-event-alignment-lint.feature`, `update-body-field-alignment.feature` - internal spec/schema consistency coverage
