@planned @lint @events
Feature: Event badge alignment lint
  Event badges are consistent across UI and specs.

  Scenario: Validate event badge mapping
    When a session event type is added
    Then the UI badge, label, and debug metadata mapping are updated together

