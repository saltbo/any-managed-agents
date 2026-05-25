@sessions @ui
Feature: Sessions UI
  Users browse and inspect sessions.

  @planned
  Scenario: Browse sessions
    Given a project has sessions
    When the user opens the sessions page
    Then sessions can be searched, filtered, sorted, opened, stopped, and archived

  @planned
  Scenario: Render the empty sessions page
    Given the project has no sessions
    When the user opens the sessions page
    Then the page shows the Sessions heading and a deliberate create action
    And the page shows search, agent filter, status filter, date filter, archived toggle, and pagination controls in disabled or empty states
    And the empty state explains that sessions are task runs of versioned agents

  @planned
  Scenario: Render the sessions table
    Given the project has active, idle, stopped, errored, and archived sessions
    When the user opens the sessions page
    Then each row shows title or id, status, agent, model, environment, started time, last update time, and duration when available
    And status badges distinguish pending, running, idle, stopped, error, and requires-action states
    And error status badges expose the status reason without adding a second table row
    And rows stay one line inside an adaptive height table surface
    And archived sessions are hidden unless the archived filter is enabled
    And clicking a row opens the session detail route

  @planned
  Scenario: Create a session from the sessions page
    Given active agents exist
    When the user starts the create-session flow
    Then the form captures agent, optional environment override, title, metadata, resources, and vault references
    And unavailable archived dependencies are disabled with explanations
    And successful save opens the session detail page with the runtime message composer ready
