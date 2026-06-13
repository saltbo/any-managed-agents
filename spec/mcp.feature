Feature: MCP
  Project-scoped MCP connectors and connections: a static connector catalog,
  per-project connections backed by vault credentials, live tool listing and
  tool-call execution through the MCP client, and governance policy enforced
  before any MCP server is contacted.

  # ── Connector catalog (domain: static directory, no tenancy) ──

  @mcp/catalog @domain
  Scenario: Expose a static connector catalog
    Given the platform seeds a connector catalog
    Then every entry is available, carries at least one tool, and declares its supported auth modes
    And connectors that need a credential require a vault credential auth mode

  @mcp/client-errors @domain
  Scenario: Normalize MCP client failures to stable categories
    Given an MCP server returns unauthorized, not found, timeout, invalid schema, or network errors
    When the MCP client categorizes the failure
    Then it maps to a stable category without exposing raw upstream detail in the safe message

  @mcp/policy-effect @domain
  Scenario: Resolve connector policy effect from project governance
    Given a project MCP policy with allow, block, approval, or default rules
    When the connector policy effect is resolved for a connector id
    Then it is allowed, blocked, or approval-required according to the policy

  # ── Discovery (api: assembled server, catalog browsing) ──

  @mcp/discovery @api
  Scenario: Browse, search, filter, and inspect the connector catalog
    Given the platform has a connector catalog
    When the user searches and filters connectors by name, category, capability, trust level, and availability
    Then results match the criteria and expose id, category, trust level, supported auth modes, and tools
    And reading a single connector returns its detail and unknown ids return not found
    And the same static catalog is served to every tenant without requiring credentials

  # ── Connection lifecycle (api: assembled server, real D1, vault refs) ──

  @mcp/connect @api
  Scenario: Connect a catalog connector with a vault credential
    Given a connector is allowed by project policy
    When the user connects it with a credential reference
    Then the connection stores only a safe credential reference and becomes connected
    And raw secret material is rejected and never persisted
    And connectors needing a credential are rejected without one

  @mcp/connection-lifecycle @api
  Scenario: Create once, conflict on duplicate, update, and disconnect a connection
    Given a connector is already connected
    When the user connects the same connector again
    Then the second create conflicts instead of duplicating
    When the user disconnects and later reconnects through state transitions
    Then the connection stays addressable and connect, update, and disconnect actions are audited without leaking secrets

  @mcp/tenancy @api
  Scenario: Enforce connection tenancy across projects
    Given a project has connected a connector
    When a user from another project lists, reads, or uses the same connection id
    Then the connection and its credential are neither visible nor usable

  # ── Tools and tool calls (api: live MCP client, canonical events) ──

  @mcp/tools @api
  Scenario: List tools from a connection by catalog or live MCP server
    Given a connection without an endpoint and a connection with an endpoint
    When the user lists tools for each connection
    Then the endpoint-less connection serves catalog tools without syncing
    And the endpoint-backed connection syncs name, description, and input schema from the live MCP server
    And a disconnected connection rejects tool listing

  @mcp/tool-call @api
  Scenario: Execute an MCP tool call as an addressable resource with canonical events
    Given a session agent is allowed to use a connected MCP tool
    When the user calls the tool through the connection
    Then the MCP client authenticates with the resolved credential and the call is stored as an addressable resource
    And tool input, output summary, duration, and safe errors are recorded as canonical session events
    And transport failures normalize to a stable error type and secret values are redacted from events and logs

  @mcp/policy-enforcement @api
  Scenario: Block or gate MCP tool calls by governance and environment policy
    Given a connector is blocked, requires approval, or is disallowed by the environment
    When an agent tries to call the connector during a session
    Then AMA denies or pauses the call before contacting the MCP server
    And a policy decision event is recorded on the session

  @mcp/credential-refresh @api
  Scenario: Honor rotated and revoked connector credentials at call time
    Given a connection backed by a vault credential
    When the credential is rotated or revoked
    Then a new call resolves the latest credential version without reconnecting
    And a revoked credential denies the call before execution

  # ── Contract (api: OpenAPI) ──

  @mcp/openapi @api
  Scenario: Publish connector and connection routes in OpenAPI
    Given the Worker app is initialized
    When the OpenAPI document is requested
    Then it includes the connectors, connections, connection tools, and tool-call paths
    And the legacy /api/mcp namespace is gone
