@planned @oma-aligned @runtime
Feature: Engine error termination
  Runtime errors terminate sessions in a visible and recoverable state.

  Scenario: Terminate after runtime failure
    When model, tool, sandbox, or policy execution fails
    Then the session records a structured error event and moves to an error state

