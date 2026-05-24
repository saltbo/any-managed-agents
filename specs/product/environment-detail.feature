@planned @ui @environments
Feature: Environment detail
  Users inspect reusable sandbox environment configuration.

  Scenario: View environment detail
    Given an environment exists
    When the user opens the environment detail page
    Then packages, variables, network policy, versions, and related agents are visible

  Scenario: Inspect environment execution policy
    Given an environment has package requirements, variables, secret references, network policy, resource limits, runtime image, metadata, and versions
    When the user opens the environment detail page
    Then the header shows name, status, current version, runtime image, and timestamps
    And package requirements are grouped by ecosystem
    And variables and secret references are displayed without raw secret values
    And network policy clearly distinguishes unrestricted and limited access
    And related agents show which agents will use the current environment version for new sessions

  Scenario: Edit an environment from detail
    Given an environment is active
    When the user edits packages, variables, secret references, network policy, resource limits, runtime image, or metadata
    Then validation errors appear next to their fields
    And successful save creates a new environment version
    And existing sessions keep their original environment snapshots

  Scenario: Archive an environment from detail
    Given an environment is active
    When the user chooses archive and confirms the destructive action
    Then the environment status becomes archived
    And new agent/session flows cannot select it by default
    And existing sessions remain readable
