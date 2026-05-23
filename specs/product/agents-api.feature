@api @agents @implemented
Feature: Agents API
  The control plane exposes APIs for project-scoped agent definitions.

  Scenario: Publish agent CRUD routes in OpenAPI
    Given the Worker app is initialized
    When I request GET "/api/openapi.json"
    Then the response status should be 200
    And the OpenAPI document should include path "/api/agents"
    And the OpenAPI path "/api/agents" should include method "get"
    And the OpenAPI path "/api/agents" should include method "post"
    And the OpenAPI document should include path "/api/agents/{agentId}"
    And the OpenAPI path "/api/agents/{agentId}" should include method "get"
    And the OpenAPI path "/api/agents/{agentId}" should include method "patch"
    And the OpenAPI path "/api/agents/{agentId}" should include method "delete"
    And the OpenAPI document should include path "/api/agents/{agentId}/versions"
    And the OpenAPI document should include path "/api/agents/{agentId}/sessions"

  Scenario: Manage project agents through the API
    Then the agents API supports create, read, update, version history, archive, and list
    And the agents API enforces auth, project tenancy, model policy, tool policy, and environment availability
    And agent sessions keep immutable agent and environment snapshots
