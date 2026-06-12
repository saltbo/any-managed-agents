@mcp
Feature: MCP client integration
  The runtime integrates with approved MCP clients and connectors.

  @implemented
  Scenario: Connect to an approved MCP server
    Given a connector is approved for a project
    When the runtime creates an MCP client
    Then calls are authenticated, scoped, and recorded as session events

  @implemented
  Scenario: Reject unapproved MCP server use
    Given a connector is not approved for the project or environment
    When a session attempts to use the connector
    Then AMA rejects the tool call before contacting the MCP server
    And records a policy event on the session

  @implemented
  Scenario: Refresh connector credentials for runtime
    Given a connector credential has been rotated
    When a new session starts
    Then the runtime resolves the latest allowed credential version
    And existing sessions keep their original safe credential reference until they stop or reconnect according to policy
