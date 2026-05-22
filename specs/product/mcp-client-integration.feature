@planned @mcp
Feature: MCP client integration
  The runtime integrates with approved MCP clients and connectors.

  Scenario: Connect to an approved MCP server
    Given a connector is approved for a project
    When the runtime creates an MCP client
    Then calls are authenticated, scoped, and recorded as session events

