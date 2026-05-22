# Product Spec Index

The product specs describe the intended end state for Any Managed Agents. Files tagged `@planned` are accepted target behavior and are excluded from the default executable BDD run until implementation begins.

This directory intentionally covers the same top-level spec file names used by OMA, rewritten as clean-room Any Managed Agents specs. Additional AMA-specific files capture Cloudflare-native runtime boundaries, Cloudflare Agent SDK ownership, and Cloudflare Sandbox SDK ownership.

## Core Platform

- `platform-principles.feature` - Cloudflare-native platform boundaries and SDK ownership rules
- `control-plane.feature` - currently implemented control-plane health behavior
- `auth-tenancy.feature` - authentication, organization, project, and user context
- `auth.feature`, `auth-flow.feature`, `auth-guard.feature`, `login.feature`, `login-page.feature`, `sso-discovery.feature`, `user-initial-password.feature`, `web-auth-redirect.feature` - authentication and login coverage

## Managed Agent Model

- `agents-control-plane.feature` - agent definitions, versions, validation, and archive behavior
- `agent-builder.feature` - guided UI for creating and testing agents
- `agent-detail.feature`, `agents-api.feature`, `agents-ui.feature`, `agents-update.feature` - OMA-aligned agent API and UI coverage
- `sessions-runtime.feature` - session lifecycle and Cloudflare Agent SDK runtime routing
- `events-streaming.feature` - transcript, debug, and event streaming behavior
- `session-detail.feature`, `session-detail-tool-tracing.feature`, `session-stop.feature`, `sessions-api.feature`, `sessions-events.feature`, `sessions-list-bulk-archive.feature`, `sessions-ui.feature` - OMA-aligned session coverage

## Execution

- `environments.feature` - reusable sandbox environment definitions
- `environment-detail.feature`, `environments-api.feature`, `environments-mcp.feature`, `environments-ui.feature` - OMA-aligned environment coverage
- `sandbox-execution.feature` - Cloudflare Sandbox SDK execution, files, commands, and policy
- `tools-mcp.feature` - tool configuration, MCP discovery, approval, and runtime enforcement
- `engine-cooperative-cancellation.feature`, `engine-error-termination.feature`, `engine-mcp.feature`, `engine-mcp-e2e.feature` - OMA-aligned runtime engine coverage
- `mcp-client.feature`, `mcp-client-integration.feature`, `mcp-connections.feature`, `mcp-discovery.feature`, `mcp-policy-enforcement.feature` - OMA-aligned MCP coverage

## Operations

- `providers-models.feature` - Workers AI and external provider support
- `provider-access.feature`, `providers.feature` - OMA-aligned provider coverage
- `vault-secrets.feature` - secret storage, redaction, rotation, and access control
- `vault-detail.feature`, `vaults.feature`, `vaults-api.feature`, `vaults-ui.feature` - OMA-aligned vault coverage
- `governance-policy.feature` - policy hierarchy, budgets, and enforcement
- `governance-api.feature`, `governance-config.feature` - OMA-aligned governance coverage
- `usage-audit.feature` - usage reporting and audit records
- `audit-auto.feature`, `audit-log-ui.feature`, `usage-summary.feature` - OMA-aligned audit and usage coverage
- `api-contracts.feature` - OpenAPI, error contracts, generated clients, and CLI automation
- `openapi.feature`, `cli.feature`, `cli-client.feature`, `cli-contract.feature`, `cli-smoke-test.feature`, `web-api-client-consolidation.feature` - OMA-aligned API and CLI coverage
- `web-ui.feature` - web console navigation and resource workflows
- `layout.feature`, `list-date-range-filters.feature`, `list-route-pagination.feature` - OMA-aligned UI infrastructure coverage
- `quickstart.feature` - first-run developer path
- `destructive-ops.feature`, `encryption.feature`, `integration-snippets.feature`, `scenario-tests.feature`, `server-tests.feature`, `ci-postgres-smoke.feature`, `postgres-translate.feature` - OMA-aligned operations and compatibility coverage
- `audit-action-alignment-lint.feature`, `event-badges-alignment-lint.feature`, `event-type-alignment-lint.feature`, `schema-handler-alignment-lint.feature`, `schemas-types-event-alignment-lint.feature`, `update-body-field-alignment.feature` - OMA-aligned spec/schema lint coverage
