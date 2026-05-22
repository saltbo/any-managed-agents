@planned @mcp @ui
Feature: MCP discovery
  Users discover available MCP connectors.

  Scenario: Search MCP connectors
    When the user searches the connector catalog
    Then results show capability, trust level, policy status, and setup requirements

