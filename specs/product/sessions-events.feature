@sessions @events
Feature: Session events
  Session events represent runtime history.

  @implemented
  Scenario: Append session event
    Given an idle session has a running Pi bridge
    When the user sends a runtime message to the session runtime endpoint
    Then message, tool, sandbox, usage, lifecycle, and error events are stored in sequence

  @implemented
  Scenario: Store message lifecycle events
    Given an idle session has a running Pi bridge
    When the user sends a runtime message to the session runtime endpoint
    Then lifecycle events are stored with monotonically increasing sequence numbers
    And message events preserve user-visible content

  @implemented
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
