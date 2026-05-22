@planned @mcp
Feature: MCP connections
  Projects manage MCP connection records.

  Scenario: Manage MCP connection
    When a user creates or updates an MCP connection
    Then the platform validates endpoint, credentials, policy, and approval mode

