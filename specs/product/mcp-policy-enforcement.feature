@planned @mcp @governance
Feature: MCP policy enforcement
  Runtime MCP calls obey project and organization policy.

  Scenario: Block disallowed MCP call
    Given a connector is blocked by policy
    When an agent tries to call it
    Then the runtime denies the call and records a policy event

