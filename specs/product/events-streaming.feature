@implemented @runtime @events
Feature: Session events and streaming
  Sessions expose durable Pi runtime events for transcripts and debugging.

  Background:
    Given a session exists

  Scenario: Record Pi runtime events
    When the user sends a message and the agent responds
    Then the platform records Pi runtime events in order
    And each stored runtime event preserves the Pi event type and payload
    And AMA control-plane lifecycle events are not mixed into the Pi runtime event log

  Scenario: Stream runtime events
    When the client subscribes to session events
    Then message deltas, tool calls, sandbox process updates, and final results are streamed over WebSocket
    And the stream carries Pi AgentSessionEvent payloads
    And reconnection can continue from the last acknowledged sequence

  Scenario: Separate transcript and debug views
    When the user opens a session detail page
    Then transcript is derived from Pi runtime events
    And debug shows the full Pi runtime event stream with structured metadata

  Scenario: Redact secrets from events
    When a tool, provider, or sandbox emits sensitive values
    Then event storage and event streams redact the secret values
    And audit records keep only safe references
