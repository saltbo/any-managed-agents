@ci @implemented
Feature: Cloudflare runtime smoke tests
  CI validates the Cloudflare runtime bindings required by the platform.

  Scenario: Validate required Cloudflare bindings
    When CI runs Cloudflare runtime tests
    Then D1, Durable Object, asset, and Worker routing bindings are validated
    And Workers AI is excluded from CI runtime tests unless Cloudflare credentials are explicitly configured

  Scenario: Validate restish OpenAPI smoke coverage
    When CI runs Cloudflare runtime tests
    Then restish discovery and the create environment, create agent, create session workflow are covered
