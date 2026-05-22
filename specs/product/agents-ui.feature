@planned @oma-aligned @ui @agents
Feature: Agents UI
  Users manage project agents from the web console.

  Scenario: Browse and filter agents
    Given a project has agents
    When the user opens the agents page
    Then the page supports search, filters, status, provider, and navigation to agent detail

