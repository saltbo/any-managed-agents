@planned @cli
Feature: CLI client
  Operators may automate control-plane resources from the command line.

  Scenario: Use the CLI with API credentials
    Given an operator has API credentials
    When the operator runs CLI commands
    Then the CLI manages control-plane resources without replacing Pi runtime traffic
