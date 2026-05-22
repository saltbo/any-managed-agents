@planned @web @api
Feature: Web API client consolidation
  Web code uses a single control-plane API client.

  Scenario: Use shared API client
    When web UI calls control-plane routes
    Then requests use shared auth, error handling, tenancy headers, and response parsing

