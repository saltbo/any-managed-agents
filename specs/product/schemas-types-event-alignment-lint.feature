@lint @schema @events @implemented
Feature: Schema type event alignment lint
  Event schemas, TypeScript types, and UI handling remain aligned.

  Scenario: Validate event schema coverage
    When event schema changes
    Then types, storage, runtime emitters, and UI renderers are updated together
