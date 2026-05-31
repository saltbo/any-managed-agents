@api @sessions
Feature: Sessions API
  The control plane exposes APIs for session lifecycle and metadata.

  @implemented
  Scenario: Manage sessions through the API
    Then the sessions API supports create, list, read, reconnect, stop, archive, and events
    And the sessions API enforces auth, project tenancy, and immutable snapshots
    And inactive session runtime requests use the standard error envelope

  @implemented
  Scenario: Create a session from an active agent and environment
    Given a signed-in user has access to a project
    And the project has an active agent and an active environment
    When the user creates a session with the agent and environment
    Then the response includes a session id, project id, organization id, status, timestamps, durable object name, sandbox id, runtime endpoint, and model config
    And the session stores immutable agent and environment snapshots
    And AMA creates cloud-owned runtime state and initializes a Cloudflare Sandbox executor
    And lifecycle and sandbox events record session creation and runtime startup

  @implemented
  Scenario: Create a session with explicit runtime inputs
    Given a project has an active agent and active environments
    When the user creates a session with an explicit environment, title, metadata, resource references, and vault references
    Then the response stores those values as safe references
    And file and repository resources are declared in the deterministic workspace manifest contract
    And vault references are exposed to the runtime only through approved secret bindings
    And raw credentials are rejected from the request body

  @implemented
  Scenario: Launch a session with an initial prompt through the API
    Given a project has an active agent and active environments
    When an external scheduler creates a session with an initial prompt and run correlation metadata
    Then the response includes the session id and run correlation metadata
    And the initial prompt is dispatched to the selected environment runtime without a browser WebSocket
    And session events can be queried for launch diagnostics and transcript progress

  @implemented
  Scenario: Reject unavailable session dependencies
    Given a user attempts to create a session
    When the agent is archived, the environment is archived, the model provider is unavailable, or the sandbox policy is blocked
    Then the request fails before starting a sandbox
    And the error envelope identifies the unavailable dependency
    And no session record is left in an active state

  @implemented
  Scenario: Reject unsupported runtime provider and model combinations
    Given a user attempts to create a session
    When the selected environment runtime does not support the selected agent provider and model
    Then the request fails before workspace allocation, sandbox creation, or self_hosted lease creation
    And the error envelope identifies the unsupported runtime, provider, and model
    And no session record is left in an active state

  @implemented
  Scenario: Run a message through the session runtime endpoint
    Given an idle session has cloud-owned runtime state and a sandbox executor
    When the user sends a runtime message to the session runtime endpoint
    Then the runtime accepts the message
    And the session status becomes running while work is in progress
    And the AMA runtime can dispatch approved tools through the Cloudflare Sandbox executor
    And message, tool, sandbox, usage, lifecycle, and error events are stored in sequence
    And the session returns to idle with a final result or moves to error with a safe failure reason

  @implemented
  Scenario: Stream and reconnect to session events
    Given a session has stored events
    When a client subscribes to session events
    Then events are streamed in sequence order
    And the client can reconnect from the last seen sequence
    And event list endpoints support pagination, order, and event type filters
    And transcript views can omit debug-only events without losing the raw debug history

  @planned
  Scenario: Require user action for approvals and custom tools
    Given a running session reaches a tool approval or custom tool call
    When the runtime requires user action
    Then the session becomes idle with a requiresAction reason and related event ids
    When the user sends a tool approval, denial, or custom tool result
    Then the runtime resumes with that result
    And all approval decisions are recorded as audit-safe events

  @implemented
  Scenario: Stop a running session cooperatively
    Given a session is running
    When the user stops the session
    Then AMA cancels cloud-owned runtime work and stops the sandbox executor
    And no new model or tool work starts after the next cancellation boundary
    And the session status becomes stopped
    And stop lifecycle events and audit records include the user-requested reason

  @implemented
  Scenario: Archive and read sessions safely
    Given a session exists
    When the user archives the session
    Then the session is hidden from default lists
    And includeArchived lists can still return it
    And runtime requests to archived, stopped, or errored sessions use the standard error envelope
    And events and immutable snapshots remain readable
