@planned @oma-aligned @lint @schema
Feature: Schema handler alignment lint
  Schemas and handlers stay synchronized.

  Scenario: Validate schema handler coverage
    When a request schema changes
    Then the route handler, tests, and OpenAPI contract are updated together

