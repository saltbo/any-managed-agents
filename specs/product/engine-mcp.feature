@planned @oma-aligned @mcp @runtime
Feature: MCP engine
  The runtime enforces MCP connector policy.

  Scenario: Enforce MCP call rules
    When an agent attempts an MCP operation
    Then the runtime checks connector policy before executing the call

