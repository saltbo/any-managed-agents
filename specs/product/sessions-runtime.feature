@runtime @sessions
Feature: Agent sessions
  A session is a tenant-scoped run of a specific agent version.

  Background:
    Given a project has an active agent definition

  @planned
  Scenario: Create a session from an agent and environment
    When the user creates a session with an agent and environment
    Then the platform stores a session record in D1
    And the session uses a snapshot of the selected agent version
    And the session uses a snapshot of the selected environment
    And the session records its sandbox id, cloud runtime state, runtime endpoint, and status

  @planned
  Scenario: Connect to a session through AMA runtime endpoints
    Given a session exists
    When the client connects through an external SDK session helper or direct runtime client
    Then runtime traffic uses AMA session endpoints
    And browser clients use WebSocket for bidirectional runtime commands and events
    And AMA persists runtime events before exposing them to clients
    And clients can list or stream persisted session events
    And the helper does not define an incompatible replacement runtime protocol

  @planned
  Scenario: Stop a running session
    Given a session is running
    When the user stops the session
    Then AMA cancels cloud-owned runtime work and stops the executor backend
    And the session status becomes stopped
    And lifecycle events record the stop

  @planned
  Scenario: Resume an idle session
    Given a session is idle
    When the user reconnects to the session
    Then session metadata, sandbox executor references, runtime endpoint, and status are available
