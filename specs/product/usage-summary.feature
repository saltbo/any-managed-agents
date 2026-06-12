@usage
Feature: Usage summary
  Operators inspect usage and cost.

  @implemented
  Scenario: View usage summary
    When the operator opens usage analytics
    Then usage is grouped by organization, project, provider, model, agent, session, and time range

  @implemented
  Scenario: Filter and group usage analytics
    Given sessions have recorded token, duration, tool, sandbox, and error usage
    When the operator filters by organization, project, provider, model, agent, session, status, or time range
    Then totals and grouped breakdowns update consistently
    And empty ranges show an explicit empty state

  @implemented
  Scenario: Attribute usage to runtime events
    Given a session records provider calls and tool calls
    When usage is summarized
    Then model usage is traceable to session events
    And tool and sandbox usage are attributed to the same session, agent version, and project

  @implemented
  Scenario: Export usage summaries
    Given an operator has permission to view usage
    When the operator exports usage for a time range
    Then the export includes stable ids, grouping fields, and safe cost metadata
    And the export respects organization and project scope
