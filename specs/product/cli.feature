@planned @oma-aligned @cli
Feature: CLI
  The CLI manages agents, sessions, providers, vaults, governance, usage, and audit records.

  Scenario: Manage project resources
    Given an authenticated operator
    When the operator uses CLI resource commands
    Then all commands are scoped to the selected organization and project

