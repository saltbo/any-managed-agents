@environments @sandbox
Feature: Execution environments
  Projects define reusable environment descriptions for sandboxed agent work.

  Background:
    Given a signed-in user has access to a project

  @planned
  Scenario: Create an environment
    When the user creates an environment with packages, variables, network policy, and metadata
    Then the platform stores the long-lived environment definition in D1
    And later sessions can reference the environment by id

  @planned
  Scenario: Attach an environment to an agent
    Given an environment exists
    When the user selects the environment for an agent
    Then new sessions for that agent inherit an environment snapshot
    And sandbox creation uses the environment snapshot

  @planned
  Scenario: Restrict environment networking
    Given an environment allows only selected outbound hosts
    When a sandbox process attempts outbound network access
    Then the runtime allows only matching hosts
    And blocked attempts are recorded as policy events

  @planned
  Scenario: Version environment changes
    Given an environment is used by existing sessions
    When the user changes packages, variables, or network policy
    Then the platform creates a new environment version
    And existing sessions continue using their original environment snapshot

  @planned
  Scenario: Environment is not a sandbox instance
    Given an environment exists
    When no session is running
    Then no sandbox instance is required
    And the environment remains available for future sessions
