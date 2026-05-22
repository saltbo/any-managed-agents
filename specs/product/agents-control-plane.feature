@planned @control-plane @agents
Feature: Agent control plane
  Users manage reusable agent definitions before starting sessions.

  Background:
    Given a signed-in user has access to a project

  Scenario: Create an agent definition
    When the user creates an agent with a name, instructions, model, and tool policy
    Then the platform stores the agent definition in D1
    And the response includes the agent id, version, and timestamps

  Scenario: Version an agent definition
    Given an agent definition exists
    When the user changes instructions, model, tools, or sandbox policy
    Then the platform creates a new immutable agent version
    And existing sessions continue using their original agent snapshot

  Scenario: Archive an agent definition
    Given an agent definition exists
    When the user archives the agent
    Then the agent no longer appears in default creation flows
    And existing sessions remain readable

  Scenario: Validate agent configuration
    When an agent is saved with an unavailable provider, blocked tool, or invalid sandbox policy
    Then the platform rejects the request with field-level validation details
