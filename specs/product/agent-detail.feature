@ui @agents
Feature: Agent detail
  Users inspect and operate a versioned agent definition.

  @implemented
  Scenario: View agent configuration and versions
    Given an agent exists
    When the user opens the agent detail page
    Then the page shows instructions, model, tools, policy, versions, and archive state

  @implemented
  Scenario: Inspect normalized agent configuration
    Given an agent exists with skills, tools, MCP connectors, metadata, and versions
    When the user opens the agent detail page
    Then the header shows name, status, and timestamps
    And the configuration view shows instructions, provider, model, skills, tools, MCP connectors, and metadata without exposing secrets or sandbox policy
    And the versions view shows each immutable version with change time and runtime-relevant fields

  @implemented
  Scenario: Edit an agent from detail
    Given an agent is active
    When the user edits runtime configuration and saves
    Then validation errors appear next to their fields
    And successful save creates a new version
    And active sessions keep their original snapshots

  @implemented
  Scenario: Archive an agent from detail
    Given an agent is active
    When the user chooses archive and confirms the destructive action
    Then the agent status becomes archived
    And create-session actions are disabled
    And existing sessions remain linked and readable
