@planned @oma-aligned @safety
Feature: Destructive operations
  Destructive actions require explicit intent and auditability.

  Scenario: Confirm destructive action
    When a user deletes, archives, revokes, or stops a sensitive resource
    Then the platform requires explicit confirmation and records an audit event

