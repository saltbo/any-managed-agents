@runtime @runners @external-runtimes
Feature: External agent runtimes on self-hosted runners
  Codex, Claude Code, and Copilot run as external agent runtimes on self-hosted
  runners while AMA remains the session control plane and canonical event store.

  Background:
    Given a project has an active agent definition

  @implemented
  Scenario: Dispatch a self-hosted session to an eligible runner
    Given a self-hosted environment selects an external runtime
    And an active runner advertises the exact runtime, provider, and model capability
    When the user creates a session in that environment
    Then AMA queues the session for that environment without creating a Cloudflare Sandbox
    And the eligible runner can claim ownership of the session
    And runners that do not advertise the exact runtime, provider, and model cannot claim the session
    And the session remains pending with a waiting-for-runner reason until a runner claims it

  @implemented
  Scenario: Establish a per-session runner WebSocket after claim
    Given a runner has claimed a self-hosted session
    When the runner starts the session runtime
    Then the runner opens an outbound WebSocket for that session to AMA
    And AMA authenticates the channel as the claimed runner and session
    And the session becomes active only after the WebSocket is accepted
    And AMA does not expose any runner-local runtime process endpoint to clients

  @implemented
  Scenario: Execute tool calls over the claimed session channel
    Given a self-hosted session has an accepted runner WebSocket
    When the cloud-side AMA control plane sends an approved tool call for the session
    Then the tool call is delivered over the session WebSocket to the owning runner
    And the runner executes the tool in the configured local execution backend
    And the runner streams stdout, stderr, output, timing, and safe errors over the same WebSocket
    And AMA stores the tool result as canonical session events before continuing the session

  @implemented
  Scenario: Recover from a broken runner session channel
    Given a self-hosted session is owned by a runner
    When the session WebSocket disconnects before the session is idle or complete
    Then AMA marks the session as waiting for runner recovery
    And the original runner can reconnect before the lease expires
    And an eligible replacement runner can claim the session after the lease expires
    And duplicate or stale channels cannot submit tool results for the session

  @implemented
  Scenario: Run a Codex session on ama-runner
    Given a self-hosted environment selects codex runtime
    And an active runner supports the selected Codex provider and model
    When the user starts a session with an initial prompt
    Then ama-runner launches the configured Codex command for that session
    And Codex receives the prompt, workspace, runtime config, and safe environment
    And Codex output is translated into canonical lifecycle, transcript, tool, usage, output, and error events
    And the session reaches idle, stopped, or error with inspectable final events

  @implemented
  Scenario: Run a Claude Code session on ama-runner
    Given a self-hosted environment selects claude-code runtime
    And an active runner supports the selected Claude Code provider and model
    When the user starts a session with an initial prompt
    Then ama-runner launches the configured Claude Code command for that session
    And Claude Code receives the prompt, workspace, runtime config, and safe environment
    And Claude Code output is translated into canonical lifecycle, transcript, tool, usage, output, and error events
    And the session reaches idle, stopped, or error with inspectable final events

  @implemented
  Scenario: Run a Copilot session on ama-runner
    Given a self-hosted environment selects copilot runtime
    And an active runner supports the selected Copilot provider and model
    When the user starts a session with an initial prompt
    Then ama-runner launches the configured Copilot command for that session
    And Copilot receives the prompt, workspace, runtime config, and safe environment
    And Copilot output is translated into canonical lifecycle, transcript, tool, usage, output, and error events
    And the session reaches idle, stopped, or error with inspectable final events

  @implemented
  Scenario: Authenticate ama-runner through OIDC device login
    Given FlareAuth exposes OAuth/OIDC device authorization for a runner client
    When the operator runs ama-runner login
    Then ama-runner starts the OIDC device authorization flow for the registered runner client
    And the operator approves the runner in the FlareAuth browser flow
    And ama-runner stores the returned token material only in the local operator environment
    And AMA accepts runner registration, claims, and session WebSockets using the FlareAuth-issued token
    And AMA does not implement a parallel runner credential issuer or store raw runner tokens in D1 responses, session events, logs, or UI state
