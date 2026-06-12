@mcp @runtime
Feature: MCP engine end-to-end
  MCP calls work through approved runtime policy.

  @implemented
  Scenario: Execute an approved MCP call
    Given an agent has access to an approved MCP connector
    When the agent calls the connector during a session
    Then the result is streamed, recorded, and scoped to the project
