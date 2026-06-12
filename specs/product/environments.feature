@environments @sandbox @runtime
Feature: Execution environments
  Projects define reusable execution environment descriptions for agent work.

  Background:
    Given a signed-in user has access to a project

  @implemented
  Scenario: Create an environment
    When the user creates an environment with packages, variables, network policy, and metadata
    Then the response stores normalized policy fields
    And later sessions can reference the environment by id

  @implemented
  Scenario: Attach an environment to a session
    Given the project has an active agent and an active environment
    When the user creates a session with the agent and environment
    Then new sessions for that agent inherit an environment snapshot
    And sandbox creation uses the environment snapshot

  @planned
  Scenario: Restrict environment networking
    Given an environment allows only selected outbound hosts
    When a sandbox process attempts outbound network access
    Then the runtime allows only matching hosts
    And blocked attempts are recorded as policy events

  @implemented
  Scenario: Version environment changes
    Given an environment is used by existing sessions
    When the user changes packages, variables, or network policy
    Then the platform creates a new environment version
    And existing sessions continue using their original environment snapshot

  @implemented
  Scenario: Environment is not a sandbox instance
    Given an environment exists
    When no session is running
    Then no sandbox instance is required
    And the environment remains available for future sessions

  @implemented
  Scenario: Define runtime hosting separately from agent persona
    When the user creates an execution environment definition
    Then the environment captures hostingMode as cloud or self_hosted
    And the environment captures runtime as ama, claude-code, codex, or copilot
    And workspace, secrets, network, resource limits, and runtime config belong to the environment
    And provider, model, persona, instructions, and policy remain on the agent
