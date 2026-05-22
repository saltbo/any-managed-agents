@planned @sandbox @runtime
Feature: Sandbox execution
  Agents execute code and file operations through Cloudflare Sandbox SDK.

  Background:
    Given a session has sandbox access enabled by policy

  Scenario: Create a sandbox for a session
    When the agent needs isolated execution
    Then the runtime obtains a sandbox through Cloudflare Sandbox SDK
    And the sandbox is associated with the organization, project, and session

  Scenario: Run a command in the sandbox
    When the agent asks the sandbox to execute a command
    Then the command runs inside the sandbox
    And stdout, stderr, exit code, and timing are recorded as session events

  Scenario: Manage sandbox files
    When the agent writes, reads, or lists files
    Then file operations use Cloudflare Sandbox SDK
    And file metadata is visible in the session debug view

  Scenario: Enforce sandbox policy
    Given a project policy disables network access or restricts commands
    When the agent attempts a blocked sandbox operation
    Then the platform denies the operation
    And records a policy event
