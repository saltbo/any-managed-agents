@planned @oma-aligned @governance
Feature: Governance configuration
  Governance can be loaded from declarative configuration.

  Scenario: Load governance config
    When an operator provides a governance config file
    Then the platform validates hierarchy, provider rules, tool rules, sandbox rules, and budgets

