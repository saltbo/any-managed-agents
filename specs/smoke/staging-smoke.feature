Feature: Staging runtime smoke
  Release evidence includes a real authenticated browser workflow against a
  deployed AMA staging origin.

  @implemented
  Scenario: Staging smoke command documents secret-backed execution
    Then the staging smoke command documents the required secret environment variables

  @implemented @auth @runtime
  Scenario: Real browser smoke is runnable with secret-backed credentials
    Given staging smoke credentials are configured
    When the real authenticated staging browser smoke runs
    Then the staging smoke authenticates without direct auth database access
    And the staging smoke creates resources through public AMA APIs
    And the staging smoke verifies runtime chat, tool rendering, debug errors, and replay dedupe
    And the staging smoke verifies real self-hosted runner daemon lease execution
