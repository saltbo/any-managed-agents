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
    And the OpenAPI document should include path "/api/sessions"

  Scenario: Manage project agents through the API
    Then the agents API supports create, read, update, version history, archive, and list
    And the agents API enforces auth, project tenancy, model policy, and tool policy
    And agent sessions keep immutable agent and environment snapshots

  Scenario: Create an agent with the smallest useful configuration
    Given a signed-in user has access to a project
    When the user creates an agent with a name and instructions
    Then the response includes an agent id, current version id, project id, timestamps, and archive state
    And the agent defaults to the project default model provider and model
    And optional fields use stable empty values instead of disappearing from the response
    And the first agent version stores the instructions, model config, tool policy, sandbox policy, and metadata

  Scenario: Create an agent with full runtime configuration
    Given a project has an active model provider
    When the user creates an agent with instructions, provider, model, allowed tools, MCP connectors, sandbox policy, and metadata
    Then the response echoes the normalized runtime configuration
    And blocked tools, unavailable models, and invalid sandbox policies are rejected with field-level validation details
    And secret material is never accepted directly inside agent metadata, tools, or connector configuration

  Scenario: Update an agent with versioned runtime semantics
    Given an agent exists with version 1
    When the user changes instructions, model config, tools, MCP connectors, sandbox policy, or metadata
    Then the platform creates version 2
    And the current agent points at version 2
    And sessions created before the update keep the version 1 snapshot
    And sessions created after the update use the version 2 snapshot

  Scenario: Partially update an agent without losing omitted fields
    Given an agent has instructions, description, model config, tools, sandbox policy, and metadata
    When the user updates only the description
    Then every omitted runtime field remains unchanged
    When the user sets a metadata key to null
    Then that key is removed while other metadata keys remain
    When the user sends an empty tools array
    Then the agent version stores an explicit empty tools policy

  Scenario: List agents with pagination and filters
    Given a project has active and archived agents created across multiple dates
    When the user lists agents with a page size
    Then the response includes data, hasMore, firstId, and lastId
    And archived agents are hidden unless includeArchived is true
    And created date filters only return agents in the requested range
    And results are scoped to the signed-in project

  Scenario: Archive an agent safely
    Given an agent exists with existing sessions
    When the user archives the agent
    Then the agent is hidden from default lists and creation flows
    And new sessions cannot be created from the archived agent
    And existing sessions and immutable snapshots remain readable
    And the archive operation records an audit event
