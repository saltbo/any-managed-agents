@planned @governance @policy
Feature: Governance and policy
  Organizations enforce provider, tool, sandbox, and budget rules across projects.

  Background:
    Given an organization has teams and projects

  Scenario: Resolve policy hierarchy
    When a session starts
    Then organization policy, team policy, project policy, and agent policy are resolved
    And the most restrictive applicable rule is enforced

  Scenario: Enforce model budget
    Given a project has a monthly model budget
    When a session would exceed the budget
    Then the model call is rejected before provider execution
    And a governance event is recorded

  Scenario: Enforce sandbox restrictions
    Given a project disables sandbox network access
    When the agent requests a networked sandbox operation
    Then the runtime denies the operation
    And explains which policy blocked it

  Scenario: Load governance from configuration
    When an operator provides a governance config
    Then the platform validates the config
    And applies it without requiring source code changes
