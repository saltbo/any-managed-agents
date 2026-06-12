@api @events
Feature: Events API
  Clients can list and stream session events.

  @implemented
  Scenario: Retrieve session events
    Given a session has events
    When the client requests events from the API
    Then events are returned in sequence order and scoped to the caller's project
