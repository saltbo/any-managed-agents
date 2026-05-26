@control-plane @agents
Feature: Agent control plane
  Users manage reusable agent definitions before starting sessions.

  Background:
    Given a signed-in user has access to a project

  @implemented
  Scenario: Create an agent definition
    When the user creates an agent with instructions, provider, model, allowed tools, MCP connectors, sandbox policy, and metadata
    Then the response includes an agent id, current version id, project id, timestamps, and archive state
    And the response echoes the normalized runtime configuration

  @implemented
  Scenario: Version an agent definition
    Given an agent exists with version 1
    When the user changes instructions, model, tools, or sandbox policy
    Then the platform creates a new immutable agent version
    And existing sessions continue using their original agent snapshot

  @implemented
  Scenario: Archive an agent definition
    Given an agent exists with existing sessions
    When the user archives the agent
    Then the agent no longer appears in default creation flows
    And existing sessions remain readable

  @implemented
  Scenario: Validate agent configuration
    When an agent is saved with an unavailable provider, blocked tool, or invalid sandbox policy
    Then the platform rejects the request with field-level validation details
