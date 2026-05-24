@planned @governance
Feature: Governance configuration
  Governance can be loaded from declarative configuration.

  Scenario: Load governance config
    When an operator provides a governance config file
    Then the platform validates hierarchy, provider rules, tool rules, sandbox rules, and budgets

  Scenario: Validate governance config before applying
    Given an operator submits declarative governance configuration
    When the config references unknown providers, teams, projects, tools, MCP connectors, or invalid budgets
    Then the platform rejects the config with field-level errors
    And no partial policy changes are applied

  Scenario: Apply governance config atomically
    Given a valid governance config is submitted
    When the platform applies it
    Then provider, model, tool, MCP, sandbox, and budget policies update together
    And the audit log records the config version, actor, and safe summary

  Scenario: Preview governance config impact
    Given a proposed config would block existing agents or future sessions
    When the operator previews the config
    Then the platform reports affected agents, environments, providers, and session creation paths
    And the preview does not change active policy
