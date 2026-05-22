@planned @oma-aligned @providers
Feature: Providers
  Operators configure model providers.

  Scenario: Configure provider
    When an operator adds a provider
    Then metadata, credentials, model catalog, rate limits, and budget policy are stored safely

