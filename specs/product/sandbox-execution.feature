@sandbox @runtime
Feature: Sandbox execution
  Cloud hosting mode runtimes execute approved workspace work inside Cloudflare Sandbox backends when required.

  Background:
    Given a session has sandbox access enabled by policy

  @planned
  Scenario: Create a sandbox for a session
    When the agent needs isolated execution
    Then AMA creates a Cloudflare Sandbox for a cloud hosting mode session
    And the sandbox is associated with the organization, project, and session
    And the sandbox is created from the session environment snapshot
    And the sandbox is owned by exactly one session
    And clients do not connect directly to a sandbox-owned runtime process

  @planned
  Scenario: Run a command in the sandbox
    When the selected session runtime dispatches an approved command tool request
    Then the command runs inside the sandbox
    And stdout, stderr, exit code, and timing are recorded as session events

  @planned
  Scenario: Manage sandbox files
    When the selected session runtime dispatches approved file tool requests
    Then file operations happen inside the Cloudflare Sandbox filesystem
    And file metadata is visible in the session debug view

  @planned
  Scenario: End sandbox with the session
    When the session stops, completes, or fails
    Then the sandbox is terminated with the session
    And the sandbox is not reused by another session

  @planned
  Scenario: Do not expose sandbox ports
    When a sandbox process starts a local service
    Then the platform does not expose a public port or preview URL for that service
    And access remains internal to the session runtime

  @planned
  Scenario: Enforce sandbox policy
    Given a project policy disables network access or restricts commands
    When the agent attempts a blocked sandbox operation
    Then the platform denies the operation
    And records a policy event

  @implemented
  Scenario: Wait for a self-hosted runner
    Given a session uses a self-hosted environment
    When no runner has leased the session work
    Then AMA keeps the session pending with a waiting-for-runner reason
    And AMA does not create a Cloudflare Sandbox for that session
