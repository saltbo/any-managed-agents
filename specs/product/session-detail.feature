@planned @sessions @ui
Feature: Session detail
  Users inspect transcripts and runtime state for a session.

  Scenario: View session detail
    Given a session exists
    When the user opens session detail
    Then transcript, debug events, status, agent snapshot, model, and sandbox references are visible

  Scenario: Inspect session header and snapshots
    Given a session exists with immutable agent and environment snapshots
    When the user opens session detail
    Then the header shows title or id, status, agent, model provider, model, environment, duration, and runtime endpoint
    And the snapshot panel shows agent instructions, tools, sandbox policy, environment packages, network policy, and safe secret references
    And sandbox identifiers and Pi runtime identifiers are visible for debugging

  Scenario: Send a runtime task from session detail
    Given a session is idle and has an active runtime endpoint
    When the user sends a task from the session detail input
    Then the UI calls the session runtime endpoint
    And the input shows a pending state while the task is accepted
    And the transcript and debug views receive new events without a full page reload
    And failures show a recoverable error message with the session left inspectable

  Scenario: View transcript and debug modes
    Given a session has message, tool, sandbox, usage, lifecycle, policy, and error events
    When the user selects transcript mode
    Then conversation-level messages and final results are emphasized
    And debug-only details are hidden but still available in debug mode
    When the user selects debug mode
    Then every event is visible with type, sequence, timestamp, payload summary, and raw detail panel

  Scenario: Export and copy session events
    Given a session has events
    When the user copies or downloads events
    Then exported content preserves event order and safe metadata
    And secret values remain redacted
