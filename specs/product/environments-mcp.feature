@environments @mcp
Feature: Environment MCP policy
  Environments can include MCP connector constraints.

  @implemented
  Scenario: Apply environment MCP restrictions
    Given an environment restricts MCP connectors
    When a session uses the environment
    Then the runtime allows only connectors permitted by the environment and project policy
