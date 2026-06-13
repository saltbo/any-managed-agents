@cli
Feature: CLI OpenAPI contract
  Restish contract checks validate the published OpenAPI command-line path.

  @implemented
  Scenario: Validate restish discovery
    Given a local AMA control-plane harness is running
    When CI configures restish with /api/v1/openapi.json
    Then restish can discover the core health, environment, agent, and session operations

  @implemented
  Scenario: Validate restish protected resource auth errors
    Given a local AMA control-plane harness is running
    When CI uses restish to send unauthenticated create environment, create agent, and create session requests
    Then restish receives the platform standard authentication error envelope
