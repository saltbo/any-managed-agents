@planned @environments @sandbox
Feature: Execution environments
  Projects define reusable execution environments for sandboxed agent work.

  Background:
    Given a signed-in user has access to a project

  Scenario: Create an environment
    When the user creates an environment with packages, variables, network policy, and metadata
    Then the platform stores the environment definition in D1
    And later sessions can reference the environment by id

  Scenario: Attach an environment to an agent
    Given an environment exists
    When the user selects the environment for an agent
    Then new sessions for that agent inherit the environment policy
    And sandbox creation uses the environment configuration

  Scenario: Restrict environment networking
    Given an environment allows only selected outbound hosts
    When a sandbox process attempts outbound network access
    Then the runtime allows only matching hosts
    And blocked attempts are recorded as policy events

  Scenario: Version environment changes
    Given an environment is used by existing sessions
    When the user changes packages, variables, or network policy
    Then the platform creates a new environment version
    And existing sessions continue using their original environment snapshot
