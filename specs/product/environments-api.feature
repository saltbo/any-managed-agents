@api @environments
Feature: Environments API
  The control plane manages reusable runtime environments.

  @implemented
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

  @implemented
  Scenario: Manage project environments through the API
    Then the environments API supports create, read, update, version history, archive, and list
    And the environments API enforces auth and project tenancy
    And environment secret handling stores references and never returns raw secret values

  @implemented
  Scenario: Create an environment with default execution policy
    Given a signed-in user has access to a project
    When the user creates an environment with only a name
    Then the response includes an environment id, current version id, project id, timestamps, and archive state
    And package lists, variables, secret references, hostingMode and runtime fields, network policy, resource limits, runtime config, and metadata have stable default values
    And the environment is stored as a reusable definition, not as a running sandbox instance

  @implemented
  Scenario: Create an environment with package, variable, runtime, network, and resource policy
    When the user creates an environment with package requirements, variables, secret references, hostingMode and runtime fields, allowed outbound hosts, MCP access rules, package-manager access rules, resource limits, runtime config, and metadata
    Then the response stores normalized policy fields
    And raw secret values are rejected
    And secret references are returned only as safe names and references
    And restricted network policy without allowed hosts, invalid package specs, and invalid host patterns return field-level validation details

  @implemented
  Scenario: Version environment changes without changing existing sessions
    Given an environment is used by existing sessions
    When the user changes packages, variables, secret references, hostingMode and runtime fields, network policy, resource limits, runtime config, or metadata
    Then the platform creates a new environment version
    And existing sessions keep their original environment snapshot
    And new sessions that reference the environment use the new environment version

  @implemented
  Scenario: Enforce environment availability for new sessions
    Given an environment is archived
    When the user creates an agent or session that references the archived environment
    Then the request is rejected with a conflict error
    And the archived environment remains readable through explicit read and includeArchived list requests

  @implemented
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

  @implemented
  Scenario: Accept self-hosted environments without starting cloud sandbox execution
    Given a signed-in user has access to a project
    When the user creates a self-hosted environment and starts a session with it
    Then the session keeps the self-hosted environment snapshot
    And the session remains pending with a waiting-for-runner reason
    And no Cloudflare Sandbox id is assigned before runner lease

  @implemented
  Scenario: Publish canonical environment hosting and runtime config fields
    Given a signed-in user has access to a project
    When the user creates an environment with hostingMode and runtime
    Then hostingMode accepts only cloud or self_hosted
    And runtime accepts only ama, claude-code, codex, or copilot
    And invalid hostingMode or runtime values return field-level validation details
    And requests using legacy environment hosting and runtime config fields fail validation
    And the API does not infer runtime ownership from the selected agent

  @implemented
  Scenario: Store environment-owned runtime configuration
    Given a signed-in user has access to a project
    When the user creates an environment with workspace, secret references, network policy, resource limits, and runtime config
    Then the environment snapshot stores those runtime fields
    And agent persona, instructions, policy, provider, and model are not stored on the environment
