@planned @oma-aligned @sessions @ui
Feature: Sessions UI
  Users browse and inspect sessions.

  Scenario: Browse sessions
    Given a project has sessions
    When the user opens the sessions page
    Then sessions can be searched, filtered, sorted, opened, stopped, and archived

