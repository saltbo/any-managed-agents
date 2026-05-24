@implemented @sessions @ui
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

  Scenario: Send a chat message from session detail
    Given a session is idle and has an active runtime endpoint
    When the user sends a message from the session detail composer
    Then the UI opens a WebSocket session to the AMA Pi runtime endpoint
    And the UI sends the message as a Pi RPC prompt command
    And the input shows a pending state while the message is accepted
    And the transcript and debug views receive the same Pi runtime event stream without HTTP polling or a full page reload
    And failures show a recoverable error message with the session left inspectable

  Scenario: Render Pi runtime events as a chat transcript
    Given a session receives Pi agent message, tool execution, lifecycle, and usage events
    When the user opens transcript mode
    Then user and assistant messages render as chat turns
    And tool executions render as structured tool rows
    And runtime progress renders as status rows
    And raw JSON payloads are available only in debug detail panels

  Scenario: View transcript and debug modes
    Given a session has Pi runtime events
    When the user selects transcript mode
    Then conversation-level messages and final results are emphasized
    And non-transcript Pi events are hidden but still available in debug mode
    When the user selects debug mode
    Then every Pi runtime event is visible with type, sequence, timestamp, payload summary, and raw detail panel

  Scenario: Export and copy session events
    Given a session has events
    When the user copies or downloads events
    Then exported content preserves event order and safe metadata
    And secret values remain redacted
