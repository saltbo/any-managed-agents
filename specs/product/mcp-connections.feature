@mcp
Feature: MCP connections
  Projects manage MCP connection records.

  Scenario: Manage MCP connection
    When a user creates or updates an MCP connection
    Then the platform validates endpoint, credentials, policy, and approval mode

  Scenario: Connect a catalog connector
    Given a connector is allowed by project policy
    When the user provides a credential reference or creates a new vault credential for the connector
    Then the platform stores only encrypted or secret-referenced credentials
    And the connection status becomes connected for the current organization or project scope
    And connector lists report connected status without exposing credentials

  Scenario: Upsert and disconnect a connector
    Given a connector is already connected
    When the user connects it again with a new credential reference
    Then the connection is updated instead of duplicated
    When the user disconnects it and confirms
    Then future sessions cannot use that connector through the old connection
    And audit events record connect, update, and disconnect actions

  Scenario: Enforce connector tenancy
    Given organization A has connected a connector
    When a user from organization B lists, reads, or uses the same connector id
    Then organization A's connection and credentials are not visible or usable
