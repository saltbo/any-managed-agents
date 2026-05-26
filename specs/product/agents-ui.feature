@ui @agents
Feature: Agents UI
  Users manage project agents from the web console.

  @planned
  Scenario: Browse and filter agents
    Given a project has agents
    When the user opens the agents page
    Then the page supports search, filters, status, provider, and navigation to agent detail

  @implemented
  Scenario: Render the empty agents page
    Given the project has no agents
    When the user opens the agents page
    Then the page shows the Agents heading and a deliberate create action
    And the empty state explains that agents are reusable definitions for future sessions

  @implemented
  Scenario: Render the agents table
    Given a project has agents
    When the user opens the agents page
    Then each agent row shows name, model, tools, status, version, and updated time
    And clicking a row opens the agent detail route
    And row actions do not trigger accidental navigation

  @implemented
  Scenario: Create an agent from the agents page
    Given a model provider is available
    When the user starts the create-agent flow
    Then the form uses the shared form components and validation states
    And the user can choose a model provider, model, skills, tools, and MCP connectors
    And saving creates the agent and returns to the browsable agents list with the new row visible
