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

  Scenario: Manage project environments through the API
    Then the environments API supports create, read, update, version history, archive, and list
    And the environments API enforces auth and project tenancy
    And environment secret handling stores references and never returns raw secret values

  @planned
  Scenario: Create an environment with default execution policy
    Given a signed-in user has access to a project
    When the user creates an environment with only a name
    Then the response includes an environment id, current version id, project id, timestamps, and archive state
    And package lists, variables, secret references, network policy, resource limits, runtime image, and metadata have stable default values
    And the environment is stored as a reusable definition, not as a running sandbox instance

  @planned
  Scenario: Create an environment with package, variable, network, and resource policy
    When the user creates an environment with package requirements, variables, secret references, allowed outbound hosts, MCP access rules, package-manager access rules, resource limits, runtime image, and metadata
    Then the response stores normalized policy fields
    And raw secret values are rejected
    And secret references are returned only as safe names and references
    And invalid package specs, invalid host patterns, and unsupported runtime images return field-level validation details

  @planned
  Scenario: Version environment changes without changing existing sessions
    Given an environment is used by existing sessions
    When the user changes packages, variables, secret references, network policy, resource limits, runtime image, or metadata
    Then the platform creates a new environment version
    And existing sessions keep their original environment snapshot
    And new sessions that reference the environment use the new environment version

  @planned
  Scenario: Enforce environment availability for new sessions
    Given an environment is archived
    When the user creates an agent or session that references the archived environment
    Then the request is rejected with a conflict error
    And the archived environment remains readable through explicit read and includeArchived list requests

  @planned
  Scenario: List environments with pagination and filters
    Given a project has active and archived environments created across multiple dates
    When the user lists environments with a page size
    Then the response includes data, hasMore, firstId, and lastId
    And archived environments are hidden unless includeArchived is true
    And created date filters only return environments in the requested range
    And results are scoped to the signed-in project

  @planned
  Scenario: Apply environment network policy to a sandbox session
    Given an environment allows only selected outbound hosts
    When a session sandbox attempts network access
    Then allowed hosts are reachable
    And blocked hosts fail with a policy event recorded on the session
    And policy event payloads do not include secrets
