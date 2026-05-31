@runtime @sessions
Feature: Agent sessions
  A session is a tenant-scoped run of a specific agent version in a selected environment runtime.

  Background:
    Given a project has an active agent definition

  @planned
  Scenario: Create a session from an agent and environment
    When the user creates a session with an agent and environment
    Then the platform stores a session record in D1
    And the session uses a snapshot of the selected agent version
    And the session uses a snapshot of the selected environment
    And the session records the validated hostingMode, runtime, provider, model, runtime endpoint, and status

  @planned
  Scenario: Validate runtime provider and model support
    Given an agent selects a provider and model
    And an environment selects a hostingMode and runtime
    When the selected environment runtime does not support the selected agent provider and model
    Then the request fails before workspace allocation, sandbox creation, or self-hosted lease creation
    And the error envelope identifies the unsupported runtime, provider, and model
    And no runtime fallback or model substitution occurs

  @planned
  Scenario: Connect to a session through AMA runtime endpoints
    Given a session exists
    When the client connects through an external SDK session helper or direct runtime client
    Then runtime traffic uses AMA session endpoints
    And browser clients use WebSocket for bidirectional runtime commands and events
    And AMA persists canonical session events before exposing them to clients
    And clients can list or stream persisted session events
    And the helper does not define an incompatible replacement runtime protocol

  @planned
  Scenario: Stop a running session
    Given a session is running
    When the user stops the session
    Then AMA sends the stop request to the selected environment runtime
    And the session status becomes stopped
    And lifecycle events record the stop

  @planned
  Scenario: Resume an idle session
    Given a session is idle
    When the user reconnects to the session
    Then session metadata, runtime endpoint, environment runtime snapshot, and status are available

  @planned
  Scenario: Keep runtime process details behind AMA endpoints
    Given a session is running in any supported runtime
    When the client sends commands or subscribes to events
    Then the client uses only AMA session endpoints
    And sandbox-owned or runner-owned runtime process endpoints are never exposed
