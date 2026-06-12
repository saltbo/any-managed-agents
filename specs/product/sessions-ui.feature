@sessions @ui
Feature: Sessions UI
  Users browse and inspect sessions.

  @implemented
  Scenario: Browse sessions
    Given a project has sessions
    When the user opens the sessions page
    Then sessions can be searched, filtered, sorted, opened, stopped, and archived

  @implemented
  Scenario: Render the empty sessions page
    Given the project has no sessions
    When the user opens the sessions page
    Then the page shows the Sessions heading and a deliberate create action
    And the empty state explains that sessions are task runs of versioned agents

  @implemented
  Scenario: Render the sessions table
    Given a project has sessions
    When the user opens the sessions page
    Then each session row shows title or id, status, agent, Agent provider and model, Environment runtime, started time, last update time, and duration when available
    And rows stay one line inside an adaptive height table surface
    And clicking a row opens the session detail route

  @implemented
  Scenario: Create a session from the sessions page
    Given active agents exist
    When the user starts the create-session flow
    Then the form captures agent provider and model, session runtime, title, metadata, resources, and vault references
    And successful save opens the session detail page with the runtime message composer ready
