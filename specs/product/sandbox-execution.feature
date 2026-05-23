@planned @sandbox @runtime
Feature: Sandbox execution
  Pi coding agent executes code and file operations inside Cloudflare Sandbox.

  Background:
    Given a session has sandbox access enabled by policy

  Scenario: Create a sandbox for a session
    When the agent needs isolated execution
    Then AMA creates a Cloudflare Sandbox for the session
    And the sandbox is associated with the organization, project, and session
    And the sandbox is created from the session environment snapshot
    And the sandbox is owned by exactly one session
    And the Pi runtime process starts inside the sandbox

  Scenario: Run a command in the sandbox
    When Pi asks the sandbox to execute a command
    Then the command runs inside the sandbox
    And stdout, stderr, exit code, and timing are recorded as session events

  Scenario: Manage sandbox files
    When Pi writes, reads, or lists files
    Then file operations happen inside the Cloudflare Sandbox filesystem
    And file metadata is visible in the session debug view

  Scenario: End sandbox with the session
    When the session stops, completes, or fails
    Then the sandbox is terminated with the session
    And the sandbox is not reused by another session

  Scenario: Do not expose sandbox ports
    When a sandbox process starts a local service
    Then the platform does not expose a public port or preview URL for that service
    And access remains internal to the session runtime

  Scenario: Enforce sandbox policy
    Given a project policy disables network access or restricts commands
    When the agent attempts a blocked sandbox operation
    Then the platform denies the operation
    And records a policy event
