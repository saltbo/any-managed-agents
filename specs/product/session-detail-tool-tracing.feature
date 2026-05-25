@sessions @tools
Feature: Session detail tool tracing
  Tool calls are visible in session detail.

  @planned
  Scenario: Inspect tool trace
    Given a session has tool calls
    When the user opens session debug view
    Then tool inputs, outputs, approval state, errors, and timing are visible with secrets redacted

  @planned
  Scenario: Pair tool results with tool calls
    Given a session emits a tool call and a later tool result
    When the user opens transcript or debug view
    Then the result shows the matching tool name, duration, approval state, and error state
    And orphaned results degrade gracefully without crashing the page

  @planned
  Scenario: Display failed tools clearly
    Given a tool result is marked as failed
    When the user views the event
    Then the event is visually distinguishable from a successful result
    And safe error details are visible
    And raw input/output values that contain secrets remain redacted
