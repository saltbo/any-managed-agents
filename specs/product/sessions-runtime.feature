@runtime @sessions
Feature: Agent sessions
  A session is a tenant-scoped run of a specific agent version in a selected session runtime.

  Background:
    Given a project has an active agent definition

  @implemented
  Scenario: Create a session from an agent and environment
    When the user creates a session with an agent and environment
    Then the platform stores a session record in D1
    And the session uses a snapshot of the selected agent version
    And the session uses a snapshot of the selected environment
    And the session records the validated hostingMode, runtime, provider, model, runtime endpoint, and status

  @implemented
  Scenario: Validate runtime provider and model support
    Given an agent selects a provider and model
    And an environment selects a hostingMode and runtime
    When the selected session runtime does not support the selected agent provider and model
    Then the request fails before workspace allocation, sandbox creation, or self-hosted lease creation
    And the error envelope identifies the unsupported runtime, provider, and model
    And no runtime fallback or model substitution occurs

  @implemented
  Scenario: Connect to a session through AMA runtime endpoints
    Given a session exists
    When the client connects through an external SDK session helper or direct runtime client
    Then runtime traffic uses AMA session endpoints
    And browser clients use WebSocket for bidirectional runtime commands and events
    And AMA persists canonical session events before exposing them to clients
    And clients can list or stream persisted session events
    And the helper does not define an incompatible replacement runtime protocol

  @implemented
  Scenario: Stop a running session
    Given a session is running
    When the user stops the session
    Then AMA sends the stop request to the selected session runtime
    And the session status becomes stopped
    And lifecycle events record the stop

  @implemented
  Scenario: Resume an idle session
    Given a session is idle
    When the user reconnects to the session
    Then session metadata, runtime endpoint, environment and runtime snapshot, and status are available

  @implemented
  Scenario: Send live commands to a self-hosted runtime session
    Given a self-hosted session has an accepted runner channel and a live runtime handle
    When a client sends a follow-up message through the AMA session endpoint
    Then AMA routes the message to the owning runner over the accepted session channel
    And the runner delivers the message to the selected runtime handle
    And AMA persists the resulting runtime activity as canonical session events

  @implemented
  Scenario: Stop a self-hosted runtime session through AMA
    Given a self-hosted session has an accepted runner channel and a live runtime handle
    When a client stops the session through the AMA session endpoint
    Then AMA sends a stop command to the owning runner over the accepted session channel
    And the runner aborts the selected runtime handle
    And AMA records lifecycle events and a terminal stopped or error status

  @planned
  Scenario: Resume a session from the latest safe checkpoint
    Given a session has a stored safe resume point
    When a client resumes the session through AMA
    Then AMA sends the resume request to the selected runtime driver or owning runner
    And the runtime continues from the safe resume point without creating a duplicate session history
    And AMA records resumed lifecycle events and later runtime activity in the same session event stream

  @implemented
  Scenario: Keep runtime process details behind AMA endpoints
    Given a session is running in any supported runtime
    When the client sends commands or subscribes to events
    Then the client uses only AMA session endpoints
    And sandbox-owned or runner-owned runtime process endpoints are never exposed
