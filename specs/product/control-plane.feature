@api @implemented
Feature: Control plane health
  As an operator
  I want the control plane to expose a health endpoint
  So that deploys and smoke tests can verify the Worker is alive

  Scenario: Health endpoint returns the product identity
    Given the Worker app is initialized
    When I request GET "/api/health"
    Then the response status should be 200
    And the response JSON field "name" should be "Any Managed Agents"
