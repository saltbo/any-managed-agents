@api
Feature: Control plane health
  As an operator
  I want the control plane to expose a health endpoint
  So that deploys and runtime checks can verify the Worker is alive

  @implemented
  Scenario: Health endpoint returns the product identity
    Given the Worker app is initialized
    When I request GET "/api/health"
    Then the response status should be 200
    And the response JSON field "name" should be "Any Managed Agents"

  @implemented
  Scenario: OpenAPI document is generated from control-plane routes
    Given the Worker app is initialized
    When I request GET "/api/openapi.json"
    Then the response status should be 200
    And the OpenAPI document should include path "/api/health"
    And the OpenAPI document should include path "/api/agents"
