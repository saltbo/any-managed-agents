@planned @sessions @events
Feature: Session events
  Session events represent runtime history.

  Scenario: Append session event
    When the runtime emits a message, tool, sandbox, policy, usage, or error event
    Then the event is stored with stable ordering and safe metadata

