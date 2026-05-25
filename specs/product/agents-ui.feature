@ui @agents
Feature: Agents UI
  Users manage project agents from the web console.

  @planned
  Scenario: Browse and filter agents
    Given a project has agents
    When the user opens the agents page
    Then the page supports search, filters, status, provider, and navigation to agent detail

  @planned
  Scenario: Render the empty agents page
    Given the project has no agents
    When the user opens the agents page
    Then the page shows the Agents heading and a deliberate create action
    And the page shows search, provider filter, status filter, archived toggle, and pagination controls in disabled or empty states
    And the empty state explains that agents are reusable definitions for future sessions

  @planned
  Scenario: Render the agents table
    Given the project has active and archived agents
    When the user opens the agents page
    Then each row shows name, model provider, model, status, version, created time, and updated time
    And archived rows are visually distinct when the archived filter is enabled
    And clicking a row opens the agent detail route
    And row actions do not trigger accidental navigation

  @planned
  Scenario: Create an agent from the agents page
    Given a model provider is available
    When the user starts the create-agent flow
    Then the form uses the shared form components and validation states
    And the user can choose a model provider, model, tools, and sandbox policy
    And saving creates the agent and returns to the browsable agents list with the new row selected or visible
