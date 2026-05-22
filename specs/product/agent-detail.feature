@planned @oma-aligned @ui @agents
Feature: Agent detail
  Users inspect and operate a versioned agent definition.

  Scenario: View agent configuration and versions
    Given an agent exists
    When the user opens the agent detail page
    Then the page shows instructions, model, tools, environment, policy, versions, and archive state

