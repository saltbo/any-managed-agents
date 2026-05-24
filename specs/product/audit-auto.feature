@planned @audit
Feature: Automatic audit logging
  Security-relevant control-plane changes create audit records automatically.

  Scenario: Record mutating actions
    When a user changes agents, sessions, providers, vaults, governance, or sandbox policy
    Then the platform writes an audit event with actor, resource, action, timestamp, and safe metadata

  Scenario: Record automated runtime policy actions
    When runtime policy blocks a provider call, tool call, MCP connector, sandbox command, network request, or credential resolution
    Then the platform writes an audit event with policy category, rule reference, session id, and safe metadata

  @planned
  Scenario: Correlate audit records with API requests
    Given a mutating API request succeeds or fails after validation
    When audit logging records the action
    Then the record includes request id, actor id, organization id, project id, resource id, action, outcome, and timestamp
    And the record can be linked to related session events when applicable
