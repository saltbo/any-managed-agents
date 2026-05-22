@planned @cli
Feature: CLI contract
  If a CLI is provided, its output remains stable for automation.

  Scenario: Emit machine-readable output
    When a CLI command is run with JSON output
    Then the response shape matches the documented control-plane API contract
