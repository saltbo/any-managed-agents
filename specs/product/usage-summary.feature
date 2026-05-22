@planned @oma-aligned @usage
Feature: Usage summary
  Operators inspect usage and cost.

  Scenario: View usage summary
    When the operator opens usage analytics
    Then usage is grouped by organization, project, provider, model, agent, session, and time range

