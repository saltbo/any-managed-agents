@planned @oma-aligned @sessions @tools
Feature: Session detail tool tracing
  Tool calls are visible in session detail.

  Scenario: Inspect tool trace
    Given a session has tool calls
    When the user opens session debug view
    Then tool inputs, outputs, approval state, errors, and timing are visible with secrets redacted

