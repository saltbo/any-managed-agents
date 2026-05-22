@planned @oma-aligned @sessions
Feature: Session stop
  Users can stop running sessions.

  Scenario: Stop session
    Given a session is running
    When the user stops the session
    Then runtime work is cancelled and the session records a stopped event

