  Feature: Audit
  Security-relevant control-plane changes and runtime policy actions create audit
  records automatically. Records carry actor, resource, action, outcome, request
  correlation, and metadata, and are queryable and exportable per organization.

  # ── Automatic recording (api: mutating actions and runtime policy actions) ──

  @audit/auto-record @api
  Scenario: Record mutating control-plane actions automatically
    Given a signed-in user
    When the user makes a mutating control-plane change
    Then an audit record captures actor, resource, action, outcome, timestamp, and metadata
    And the record correlates to the request and omits the organization id

  @audit/runtime-policy @api
  Scenario: Record automated runtime policy denials
    Given a session evaluation is denied by provider, sandbox, or tool policy
    When the runtime blocks the action
    Then an audit record captures the policy category, rule reference, and session id

  @audit/records-api @api
  Scenario: List, read, and filter audit records within organization scope
    Given audit records exist for the organization
    When the operator lists and reads audit records
    Then records filter by action and outcome and stay scoped to the organization
    And a single record is readable and unknown ids return not found
    And the organization id is never exposed

  @audit/export-api @api
  Scenario: Export audit records as CSV
    Given audit records exist
    When the operator exports the filtered audit records
    Then the export returns CSV with stable identifiers and event metadata

  # ── Web console (web: audit log list and record detail in jsdom) ──

  @audit/console-list @web
  Scenario: Render the audit log list and filters
    Given audit records exist
    When the operator opens the audit log
    Then each row shows action, outcome, resource, actor, policy, request, and created time
    And the page exposes action, resource, actor, outcome, and time-range filters
    And no matching records show an explicit empty state

  @audit/console-detail @web
  Scenario: Inspect an audit record detail
    Given an audit record exists for a resource change
    When the operator opens the record detail
    Then the detail shows actor, request correlation, resource link, and before/after change
    And the detail shows metadata recorded with the event
