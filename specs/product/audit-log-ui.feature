@planned @ui @audit
Feature: Audit log UI
  Operators inspect project and organization audit history.

  Scenario: Filter audit records
    Given audit records exist
    When the operator opens the audit log
    Then records can be filtered by actor, action, resource, project, and time range

  Scenario: Render audit log states
    Given audit records are loading
    Then the audit page shows a loading state using shared UI primitives
    When no records match the filters
    Then the page shows an empty state
    When records exist
    Then each row shows timestamp, actor, action, resource type, resource id, project, and outcome

  Scenario: Inspect an audit record
    Given an audit record exists for a resource change
    When the operator opens the record detail
    Then the detail shows safe before/after metadata, request origin, correlation id, and related resource links
    And secret values and credential material are redacted

  Scenario: Export audit records from the UI
    Given the operator has filtered audit records
    When the operator exports the current view
    Then the export uses the same filters and organization scope
    And includes stable identifiers and safe metadata only
