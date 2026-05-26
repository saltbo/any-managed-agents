@web @api
Feature: Web API client consolidation
  Web code uses a single control-plane API client.

  @implemented
  Scenario: Use Hono RPC for internal web control-plane calls
    Given the local real UI e2e app is running
    When web UI calls control-plane routes
    Then requests use the shared Hono RPC client with shared auth, error handling, tenancy headers, and response parsing
    And external automation remains described by the OpenAPI document
