@mcp @ui
Feature: MCP discovery
  Users discover available MCP connectors.

  @planned
  Scenario: Search MCP connectors
    When the user searches the connector catalog
    Then results show capability, trust level, policy status, and setup requirements

  @planned
  Scenario: List the connector catalog
    Given the platform has a connector catalog
    When the user opens MCP discovery
    Then connectors show id, name, description, category, trust level, supported auth modes, policy status, connection status, and setup requirements
    And unavailable or policy-blocked connectors are visibly disabled with an explanation

  @planned
  Scenario: Search and filter connectors
    Given the connector catalog includes multiple categories
    When the user searches by name, category, capability, or trust level
    Then every result matches the selected criteria
    And no credential values are required to browse the catalog

  @planned
  Scenario: Inspect a connector
    Given a connector exists
    When the user opens connector detail
    Then the page shows setup instructions, required credential type, available capabilities, policy status, and connection actions
    And unknown connectors return a not-found error instead of a server error
