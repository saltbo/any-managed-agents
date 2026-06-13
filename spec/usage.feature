Feature: Usage
  Operators inspect token, cost, duration, and tool usage attributed to sessions,
  agents, providers, and models. Usage is queryable as raw records and as grouped
  summaries, both scoped to the organization and exportable.

  # ── Aggregation (domain: deterministic folding, cheapest layer) ──

  @usage/summary @domain
  Scenario: Summarize usage into grand totals and stable groups
    Given usage measurements with provider, model, agent, tokens, duration, and cost
    When usage is summarized by a grouping dimension
    Then grand totals fold across every row
    And groups are stable, fall back from provider id to provider type, and keep null keys
    And no rows produce empty totals and no groups

  # ── API contract (api: assembled server, filters, scope, export) ──

  @usage/summary-api @api
  Scenario: Query the usage summary with grouping and filters
    Given the project has recorded usage across providers, models, agents, and dates
    When the operator requests the usage summary
    Then totals and grouped breakdowns are returned with named totals
    And grouping by provider, model, or agent and from/to filters are honored
    And it defaults to grouping by provider and rejects unknown groupBy values

  @usage/records-api @api
  Scenario: List and read raw usage records within organization scope
    Given the project has recorded usage records
    When the operator lists records and reads a single record
    Then provider, session, and time-range filters narrow the list
    And a single record is readable and unknown ids return not found
    And responses never expose the organization id

  @usage/export-api @api
  Scenario: Export usage records and summaries
    Given the operator can view usage
    When the operator requests usage with an Accept of text/csv
    Then the export returns CSV with stable ids and safe grouping and cost fields
    And the export respects provider and time-range filters and organization scope

  # ── Web console (web: usage analytics surface in jsdom) ──

  @usage/console-view @web
  Scenario: Render the usage analytics view
    Given a usage summary with totals and groups
    Then the view shows grand totals and a row per group
    And an empty summary shows an explicit empty state
