# Product Spec Index

The product specs describe the intended end state for Any Managed Agents. Files tagged `@planned` are accepted target behavior and are excluded from the default executable BDD run until implementation begins.

These specs align to the managed-agents product capability set, not to another project's file layout. Specs that imply a different architecture, such as Postgres-first storage, a maintained client SDK, a required CLI, or repo-specific lint specs, do not belong here unless we explicitly choose those product surfaces.

## Core Platform

- `platform-principles.feature` - Cloudflare-native platform boundaries and SDK ownership rules
- `control-plane.feature` - currently implemented control-plane health behavior
- `auth-tenancy.feature` - authentication, organization, project, and user context

## Managed Agent Model

- `agents-control-plane.feature` - agent definitions, versions, validation, and archive behavior
- `agent-builder.feature` - guided UI for creating and testing agents
- `sessions-runtime.feature` - session lifecycle and Cloudflare Agent SDK runtime routing
- `events-streaming.feature` - transcript, debug, and event streaming behavior

## Execution

- `environments.feature` - reusable sandbox environment definitions
- `sandbox-execution.feature` - Cloudflare Sandbox SDK execution, files, commands, and policy
- `tools-mcp.feature` - tool configuration, MCP discovery, approval, and runtime enforcement

## Operations

- `providers-models.feature` - Workers AI and external provider support
- `vault-secrets.feature` - secret storage, redaction, rotation, and access control
- `governance-policy.feature` - policy hierarchy, budgets, and enforcement
- `usage-audit.feature` - usage reporting and audit records
- `api-contracts.feature` - OpenAPI and error contracts for control-plane automation
- `web-ui.feature` - web console navigation and resource workflows
- `quickstart.feature` - first-run developer path
