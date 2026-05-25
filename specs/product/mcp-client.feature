@mcp
Feature: MCP client
  The MCP client handles connector lifecycle and errors.

  @planned
  Scenario: Handle MCP transport failure
    When an MCP transport fails
    Then the session records a structured tool error and continues or terminates according to policy

  @planned
  Scenario: List tools from a connected MCP server
    Given a connector is connected with an approved credential
    When the platform lists MCP tools for that connector
    Then the MCP client authenticates with the resolved credential
    And returns tool name, description, and input schema
    And the response is scoped to the current organization and project policy

  @planned
  Scenario: Call an MCP tool from a session
    Given a session agent is allowed to use an MCP tool
    When the Pi runtime requests the tool
    Then AMA calls the MCP server through the MCP client
    And tool input, output summary, duration, and safe errors are recorded as session events
    And secret values are redacted from events and logs

  @planned
  Scenario: Normalize MCP client errors
    Given an MCP server returns unauthorized, not found, timeout, invalid schema, or network errors
    When the MCP client handles the failure
    Then AMA maps it to a stable error type and HTTP status for control-plane calls
    And runtime sessions continue or terminate according to tool policy
