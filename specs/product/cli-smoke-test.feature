@planned @cli @ci
Feature: CLI smoke test
  If a CLI is provided, CI validates it can reach a deployed or local control plane.

  Scenario: Smoke test CLI health
    When the CLI checks platform health
    Then it receives the product identity and exits successfully
