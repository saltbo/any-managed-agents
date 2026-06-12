@runtime
Feature: Engine cooperative cancellation
  Running sessions can be stopped without starting additional work.

  @implemented
  Scenario: Cancel a running session
    Given a session is running model, tool, or sandbox work
    When the user stops the session
    Then the runtime sends a cancellation signal and records the final stopped status

