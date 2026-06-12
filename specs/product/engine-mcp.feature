@mcp @runtime
Feature: MCP engine
  The runtime enforces MCP connector policy.

  @implemented
  Scenario: Enforce MCP call rules
    When an agent attempts an MCP operation
    Then the runtime checks connector policy before executing the call
