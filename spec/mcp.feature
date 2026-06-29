Feature: MCP
  Platform MCP connectors are a catalog of MCP servers. Project credentials are
  stored as vault credentials with connector bindings. Session startup resolves
  the agent's connector ids into an MCP server manifest for the runtime; AMA does
  not expose a connection resource and does not proxy MCP tool calls.

  # ── Connector catalog (domain: static directory, no tenancy) ──

  @mcp/catalog @domain
  Scenario: Expose a static connector catalog
    Given the platform seeds a connector catalog
    Then every entry is available, carries at least one tool, and declares its supported auth modes
    And connectors that need a credential require a vault credential auth mode

  # ── Discovery (api: assembled server, catalog browsing) ──

  @mcp/discovery @api
  Scenario: Browse, search, filter, and inspect the connector catalog
    Given the platform has a connector catalog
    When the user searches and filters connectors by name, category, capability, trust level, and availability
    Then results match the criteria and expose id, category, trust level, supported auth modes, and tools
    And reading a single connector returns its detail and unknown ids return not found
    And the same static catalog is served to every tenant without requiring credentials

  # ── Credentials (api: assembled server, real D1, vault refs) ──

  @mcp/credential-binding @api
  Scenario: Bind a vault credential to a catalog connector
    Given a catalog connector requires a credential
    When the user creates a vault credential with a connector binding
    Then the credential stores only a safe secret reference and connector id
    And raw secret material is rejected and never persisted

  @mcp/credential-tenancy @api
  Scenario: Enforce connector credential tenancy across projects
    Given a project has a connector-bound credential
    When a user from another project lists or reads vault credentials
    Then the credential and its secret reference are not visible

  # ── Runtime manifest (usecase: session startup) ──

  @mcp/runtime-manifest @usecase
  Scenario: Resolve agent MCP connectors into a runtime server manifest
    Given an agent references catalog connector ids
    And the project has matching connector-bound vault credentials where needed
    When a session starts
    Then the runtime receives MCP server endpoint metadata, catalog tools, and safe credential references
    And missing unavailable connectors are omitted from the manifest

  @mcp/credential-refresh @usecase
  Scenario: Honor rotated and revoked connector credentials at call time
    Given an agent references a connector backed by a vault credential
    When the credential is rotated or revoked before session startup
    Then startup resolves the latest active credential version
    And a revoked credential is not included in the runtime manifest

  # ── Contract (api: OpenAPI) ──

  @mcp/openapi @api
  Scenario: Publish connector routes in OpenAPI
    Given the Worker app is initialized
    When the OpenAPI document is requested
    Then it includes the connector catalog paths
    And it does not include connection, connection tool, or MCP tool-call paths
    And the legacy /api/mcp namespace is gone
