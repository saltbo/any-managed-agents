# Product Spec Index

The product specs describe the intended end state for Any Managed Agents. Files tagged `@planned` are accepted target behavior and are excluded from the default executable BDD run until implementation begins.

This directory covers managed-agents capability areas as clean-room Any Managed Agents specs. Coverage is by product capability, not by copying another project's file layout. Cloudflare Workers, Pi coding agent, Cloudflare Sandbox, D1, Durable Objects, and Workers AI are architectural constraints.

This repository publishes the OpenAPI contract for product resources. Language SDKs are generated and maintained in separate repositories. Pi protocol is the v1.0 runtime protocol, and Cloudflare Sandbox remains the sandbox execution foundation.

## Core Platform

- `platform-principles.feature` - Cloudflare-native platform boundaries, OpenAPI ownership, and SDK ownership rules
- `control-plane.feature` - currently implemented control-plane health behavior
- `auth-tenancy.feature` - authentication, organization, project, and user context
- `auth.feature`, `auth-flow.feature`, `auth-guard.feature`, `login.feature`, `login-page.feature`, `sso-discovery.feature`, `user-initial-password.feature`, `web-auth-redirect.feature` - authentication and login coverage

## Managed Agent Model

- `agents-control-plane.feature` - agent definitions, versions, validation, and archive behavior
- `agent-builder.feature` - guided UI for creating and testing agents
- `agent-detail.feature`, `agents-api.feature`, `agents-ui.feature`, `agents-update.feature` - agent API and UI coverage
- `sessions-runtime.feature` - session lifecycle and Pi runtime proxy behavior
- `events-streaming.feature` - transcript, debug, and event streaming behavior
- `session-detail.feature`, `session-detail-tool-tracing.feature`, `session-stop.feature`, `sessions-api.feature`, `sessions-events.feature`, `sessions-list-bulk-archive.feature`, `sessions-ui.feature` - session coverage

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
- `api-contracts.feature` - OpenAPI, external SDK, and error contracts for control-plane automation
- `openapi.feature`, `web-api-client-consolidation.feature` - API contract coverage
- `cli.feature`, `cli-client.feature`, `cli-contract.feature`, `cli-smoke-test.feature` - optional control-plane CLI coverage, not runtime protocol coverage
- `web-ui.feature` - web console navigation and resource workflows
- `layout.feature`, `list-date-range-filters.feature`, `list-route-pagination.feature` - UI infrastructure coverage
- `quickstart.feature` - first-run developer path
- `destructive-ops.feature`, `encryption.feature`, `integration-snippets.feature`, `scenario-tests.feature`, `server-tests.feature`, `ci-cloudflare-smoke.feature`, `storage-cloudflare-d1.feature` - operations, storage, and compatibility coverage
- `audit-action-alignment-lint.feature`, `event-badges-alignment-lint.feature`, `event-type-alignment-lint.feature`, `schema-handler-alignment-lint.feature`, `schemas-types-event-alignment-lint.feature`, `update-body-field-alignment.feature` - internal spec/schema consistency coverage
