@planned @oma-aligned @audit
Feature: Automatic audit logging
  Security-relevant control-plane changes create audit records automatically.

  Scenario: Record mutating actions
    When a user changes agents, sessions, providers, vaults, governance, or sandbox policy
    Then the platform writes an audit event with actor, resource, action, timestamp, and safe metadata

