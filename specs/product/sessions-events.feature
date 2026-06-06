@sessions @events
Feature: Session events
  Session events are the canonical AMA runtime history contract.

  @implemented
  Scenario: Append session event
    Given an idle session has cloud-owned runtime state and a sandbox executor
    When the user sends a runtime message to the session runtime endpoint
    Then message, tool, sandbox, usage, lifecycle, and error events are stored in sequence

  @implemented
  Scenario: Store message lifecycle events
    Given an idle session has cloud-owned runtime state and a sandbox executor
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

  @implemented
  Scenario: Normalize all runtime output into the canonical event protocol
    Given a session runs with ama, claude-code, codex, or copilot runtime
    When the runtime emits lifecycle, message, tool, and usage activity
    Then AMA stores the activity as canonical session events
    And UI, API, and session-state views read only canonical session events
    And runtime-specific details appear only as safe metadata

  @planned
  Scenario: Preserve event hierarchy for product consumers
    Given a runtime emits nested turns, messages, tool calls, permission requests, and substeps
    When AMA stores the session events
    Then every canonical event has a stable event id and monotonically increasing sequence
    And related events share stable turn, message, tool call, and span identifiers
    And child events reference their parent event, tool call, or span where nesting exists
    And product clients can reconstruct transcript, tool progress, runtime diagnostics, usage, and errors without raw runtime events

  @planned
  Scenario: Record runtime checkpoints and resume tokens as canonical events
    Given a runtime creates a checkpoint, thread id, session id, or resume token
    When AMA receives the runtime update
    Then AMA stores a canonical checkpoint or runtime metadata event with a safe resume reference
    And the raw provider token value is redacted when it is sensitive
    And session state can identify the latest safe resume point without parsing raw runtime events
