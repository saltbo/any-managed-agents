@governance @policy
Feature: Governance and policy
  Organizations enforce provider, tool, sandbox, and budget rules across projects.

  Background:
    Given an organization has teams and projects

  @planned
  Scenario: Resolve policy hierarchy
    When a session starts
    Then organization policy, team policy, project policy, and agent policy are resolved
    And the most restrictive applicable rule is enforced

  @planned
  Scenario: Enforce model budget
    Given a project has a monthly model budget
    When a session would exceed the budget
    Then the model call is rejected before provider execution
    And a governance event is recorded

  @planned
  Scenario: Enforce sandbox restrictions
    Given a project disables sandbox network access
    When the agent requests a networked sandbox operation
    Then the runtime denies the operation
    And explains which policy blocked it

  @planned
  Scenario: Load governance from configuration
    When an operator provides a governance config
    Then the platform validates the config
    And applies it without requiring source code changes

  @planned
  Scenario: Explain policy denials to operators
    Given a request is denied by provider, tool, MCP, sandbox, or budget policy
    When the user inspects the failure
    Then the response identifies the policy category and safe resource reference
    And the UI can link to the effective policy view
    And no secret or raw credential values are included

  @planned
  Scenario: Preserve historical sessions after policy changes
    Given a session was created under an older policy
    When governance policy changes
    Then historical session events and snapshots remain readable
    And reconnecting or sending new work uses the current effective policy
