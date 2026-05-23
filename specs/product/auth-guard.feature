@auth
Feature: Authentication guard
  Protected routes reject unauthenticated access.

  Scenario: Guard protected resources
    Given the Worker app is initialized
    When I request GET "/api/agents"
    Then the response status should be 401
    And the response error type should be "authentication_required"
    And the response should not include tenant data
