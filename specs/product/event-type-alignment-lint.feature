@planned @oma-aligned @lint @events
Feature: Event type alignment lint
  Event type identifiers stay consistent across schema, runtime, and UI.

  Scenario: Validate event type coverage
    When an event type is defined
    Then storage schema, runtime emitters, UI renderers, and docs all recognize it

