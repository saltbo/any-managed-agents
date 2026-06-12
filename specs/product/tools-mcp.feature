@tools @mcp
Feature: Tools and MCP
  Agents use project-approved tools and MCP servers.

  Background:
    Given a project has tool and MCP policies

  @planned
  Scenario: Attach tools to an agent version
    When the user configures tools for an agent
    Then each tool is stored with name, description, schema, approval mode, and policy metadata

  @planned
  Scenario: Discover MCP connectors
    When the user browses available MCP connectors
    Then connectors can be searched and filtered by capability, trust level, and policy status

  @implemented
  Scenario: Require approval for sensitive tools
    Given a tool requires human approval
    When the agent requests that tool
    Then the session pauses for approval
    And the tool does not execute until an authorized user approves it

  @planned
  Scenario: Enforce MCP policy at runtime
    Given an MCP connector is blocked for a project
    When an agent attempts to call the connector
    Then the platform rejects the call
    And records a policy event
