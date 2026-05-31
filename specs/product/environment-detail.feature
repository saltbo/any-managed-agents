@ui @environments
Feature: Environment detail
  Users inspect reusable sandbox environment configuration.

  @planned
  Scenario: View environment detail
    Given an environment exists
    When the user opens the environment detail page
    Then packages, variables, network policy, versions, and sessions that selected the environment are visible

  @planned
  Scenario: Inspect environment execution policy
    Given an environment has package requirements, variables, secret references, network policy, resource limits, runtime config, metadata, and versions
    When the user opens the environment detail page
    Then the header shows name, status, current version, runtime config, and timestamps
    And package requirements are grouped by ecosystem
    And variables and secret references are displayed without raw secret values
    And network policy clearly distinguishes unrestricted and limited access
    And related sessions show historical runs that selected the environment

  @planned
  Scenario: Edit an environment from detail
    Given an environment is active
    When the user edits packages, variables, secret references, network policy, resource limits, runtime config, or metadata
    Then validation errors appear next to their fields
    And successful save creates a new environment version
    And existing sessions keep their original environment snapshots

  @planned
  Scenario: Archive an environment from detail
    Given an environment is active
    When the user chooses archive and confirms the destructive action
    Then the environment status becomes archived
    And new session flows cannot select it
    And existing sessions remain readable
