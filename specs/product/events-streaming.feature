@planned @runtime @events
Feature: Session events and streaming
  Sessions expose durable events for transcripts, debugging, and audit.

  Background:
    Given a session exists

  Scenario: Record user and assistant messages
    When the user sends a message and the agent responds
    Then the platform records message events in order
    And each event includes tenant, session, type, timestamp, and sequence

  Scenario: Stream runtime events
    When the client subscribes to session events
    Then message deltas, tool calls, sandbox process updates, and final results are streamed
    And reconnection can continue from the last acknowledged sequence

  Scenario: Separate transcript and debug views
    When the user opens a session detail page
    Then transcript events are shown as conversation history
    And debug events are shown with structured metadata

  Scenario: Redact secrets from events
    When a tool, provider, or sandbox emits sensitive values
    Then event storage and event streams redact the secret values
    And audit records keep only safe references
