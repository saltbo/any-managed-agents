@planned @oma-aligned @mcp
Feature: MCP client
  The MCP client handles connector lifecycle and errors.

  Scenario: Handle MCP transport failure
    When an MCP transport fails
    Then the session records a structured tool error and continues or terminates according to policy

