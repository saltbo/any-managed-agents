@planned @ui @audit
Feature: Audit log UI
  Operators inspect project and organization audit history.

  Scenario: Filter audit records
    Given audit records exist
    When the operator opens the audit log
    Then records can be filtered by actor, action, resource, project, and time range

