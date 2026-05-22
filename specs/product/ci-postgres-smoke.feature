@planned @oma-aligned @ci
Feature: Relational database smoke compatibility
  CI can validate optional relational database integrations if they are introduced.

  Scenario: Skip unavailable optional database integrations
    When a relational database backend is not configured
    Then CI continues to validate the required Cloudflare D1 backend

