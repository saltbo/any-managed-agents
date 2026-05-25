@analytics @audit
Feature: Usage and audit
  Operators can inspect usage, cost, and security-relevant actions.

  Background:
    Given an organization has active sessions

  @planned
  Scenario: Summarize usage
    When the operator views usage
    Then usage is grouped by organization, project, provider, model, agent, and session
    And the summary includes time range filters

  @planned
  Scenario: Record audit events
    When a user changes agents, providers, vaults, governance, or sessions
    Then the platform records actor, action, resource, timestamp, and safe metadata

  @planned
  Scenario: Inspect policy denials
    When a request is denied by governance policy
    Then the audit log includes the policy rule and resource reference
    And does not include secret values

  @planned
  Scenario: Export audit records
    When an operator exports audit records for a time range
    Then the export includes stable identifiers and event metadata
    And respects the operator's organization scope
