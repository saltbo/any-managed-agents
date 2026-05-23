@api @environments @implemented
Feature: Environments API
  The control plane manages reusable sandbox environments.

  Scenario: Publish environment CRUD routes in OpenAPI
    Given the Worker app is initialized
    When I request GET "/api/openapi.json"
    Then the response status should be 200
    And the OpenAPI document should include path "/api/environments"
    And the OpenAPI path "/api/environments" should include method "get"
    And the OpenAPI path "/api/environments" should include method "post"
    And the OpenAPI document should include path "/api/environments/{environmentId}"
    And the OpenAPI path "/api/environments/{environmentId}" should include method "get"
    And the OpenAPI path "/api/environments/{environmentId}" should include method "patch"
    And the OpenAPI path "/api/environments/{environmentId}" should include method "delete"
    And the OpenAPI document should include path "/api/environments/{environmentId}/versions"
