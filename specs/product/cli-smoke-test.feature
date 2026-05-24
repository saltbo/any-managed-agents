@planned @cli @ci
Feature: CLI smoke test
  Restish smoke tests validate the published OpenAPI command-line path.

  Scenario: Smoke test restish discovery
    Given a local or deployed AMA control plane is running
    When CI configures restish with /api/openapi.json
    Then restish can discover the health, agents, environments, and sessions operations
    And a health request receives the product identity and exits successfully

  Scenario: Smoke test restish resource workflow
    Given test credentials are available
    When CI uses restish to create an environment, create an agent, and create a session
    Then every command succeeds or fails with a documented error envelope
    And no bespoke CLI binary is required
