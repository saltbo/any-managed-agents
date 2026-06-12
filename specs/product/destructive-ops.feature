@safety
Feature: Destructive operations
  Destructive actions require explicit intent and auditability.

  @implemented
  Scenario: Confirm destructive action
    When a user deletes, archives, revokes, or stops a sensitive resource
    Then the platform requires explicit confirmation and records an audit event

  @implemented
  Scenario: Use consistent destructive confirmations
    When a user archives agents, environments, sessions, vaults, credentials, providers, MCP connections, or governance rules
    Then the UI uses the shared confirmation dialog pattern
    And the dialog names the resource and consequence
    And cancel leaves the resource unchanged

  @implemented
  Scenario: Distinguish archive, revoke, stop, and hard delete
    When a destructive operation is offered
    Then the product labels whether it is reversible archive, credential revoke, session stop, or permanent delete
    And permanent delete is available only when the resource has no required historical references

  @planned
  Scenario: Stop batch destructive operations on first failure
    Given a user performs a batch archive or revoke operation
    When one item fails
    Then later items are not processed
    And the UI reports which items succeeded and which item failed
    And selection state supports retry without guessing
