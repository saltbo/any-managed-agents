@sessions @events
Feature: Session events
  Session events represent runtime history.

  @planned
  Scenario: Append session event
    When the runtime emits a message, tool, sandbox, policy, usage, or error event
    Then the event is stored with stable ordering and safe metadata

  @planned
  Scenario: Store message lifecycle events
    Given a user sends a runtime message
    When the runtime accepts, starts, streams, completes, or fails the message
    Then lifecycle events are stored with monotonically increasing sequence numbers
    And message events preserve user-visible content
    And debug events preserve safe runtime diagnostics

  @planned
  Scenario: Query session events
    Given a session has many events
    When the client lists events with limit, order, type filter, or cursor
    Then the response returns a deterministic page
    And hasMore, firstId, lastId, and sequence boundaries allow stable pagination

  @planned
  Scenario: Redact sensitive event payloads
    Given a provider, tool, MCP connector, vault, or sandbox process emits sensitive values
    When the event is stored or streamed
    Then secret values are replaced with safe references
    And audit metadata records the source without exposing the secret
