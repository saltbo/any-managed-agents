@planned @sessions @ui
Feature: Session detail
  Users inspect transcripts and runtime state for a session.

  Scenario: View session detail
    Given a session exists
    When the user opens session detail
    Then transcript, debug events, status, agent snapshot, model, and sandbox references are visible

