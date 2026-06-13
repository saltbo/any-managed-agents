Feature: Runtime
  AMA owns the session runtime engine: it drives model, tool, and sandbox work for
  a session, normalizes everything into canonical events, and exposes runtime only
  through AMA session endpoints — never sandbox- or runner-local processes. Running
  sessions cancel cooperatively and runtime failures terminate sessions in a
  visible, recoverable state.

  # ── Runtime drivers (domain: pure driver selection and metadata) ──

  @runtime/driver-select @domain
  Scenario: Select a supported runtime driver
    Given a session selects a hosting mode and runtime
    When the platform resolves the runtime driver
    Then it picks the canonical cloud or self-hosted driver and rejects unknown runtimes
    And persisted runtime driver metadata is preserved over defaults

  @runtime/endpoints @domain
  Scenario: Expose runtime only through AMA session endpoints
    Given a session runs in any supported runtime
    When a client sends commands or subscribes to events
    Then the client uses only AMA session runtime endpoints derived from the session id
    And sandbox-owned or runner-owned runtime process endpoints are never exposed

  # ── Turn engine (usecase: model + tool + sandbox orchestration) ──

  @runtime/turn @usecase
  Scenario: Run a turn through the model and dispatch tool calls
    Given a session has an agent snapshot, prompt, and configured tool executor
    When the runtime runs the turn
    Then model output is produced and tool calls are dispatched through the executor
    And the next turn context is reconstructed from persisted canonical events

  @runtime/cooperative-cancellation @usecase
  Scenario: Cancel a running session without starting more work
    Given a session is running model, tool, or sandbox work
    When the cancellation gate trips before completion
    Then the turn aborts and no successful completion events are persisted
    And no new work starts after the cancellation boundary

  @runtime/error-termination @usecase
  Scenario: Terminate a session after a runtime failure
    Given a tool is dispatched that violates the agent allow-list or fails to execute
    When the runtime executes the turn
    Then a structured error event is recorded and the turn does not complete successfully

  @runtime/sandbox-toolset @usecase
  Scenario: Gate sandbox tools by the agent allow-list
    Given an agent declares a sandbox tool allow-list
    When the runtime initializes sandbox workspace metadata and dispatches sandbox work
    Then tools absent from a non-empty allow-list are rejected
    And an agent with no explicit allow-list is granted the full sandbox toolset

  # ── Session lifecycle over AMA endpoints (api: cooperative stop) ──

  @runtime/stop @api
  Scenario: Stop a running session cooperatively over the API
    Given a session is running through the AMA runtime endpoint
    When the user stops the session through the sessions API
    Then the status becomes stopped and no successful completion events are written after cancellation
