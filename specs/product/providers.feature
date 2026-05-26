@providers
Feature: Providers
  Operators configure model providers.

  @implemented
  Scenario: Configure provider
    When an operator adds a provider
    Then metadata, credentials, model catalog, rate limits, and budget policy are stored safely

  @implemented
  Scenario: List providers on a fresh project
    Given no project-specific providers are configured
    When an operator lists providers
    Then the response shows platform default providers separately from project overrides
    And each provider reports id, type, display name, default status, credential status, model catalog status, and timestamps
    And secret values are never returned

  @implemented
  Scenario: Add Workers AI as the default provider
    When an operator enables Workers AI for a project
    Then the provider stores Cloudflare account metadata and safe credential references
    And it can be marked as the only default provider
    And model discovery includes Workers AI model ids allowed by governance

  @implemented
  Scenario: Add external and OpenAI-compatible providers
    When an operator adds Anthropic, OpenAI, OpenAI-compatible, Ollama, or another supported provider
    Then provider type, base URL when required, display name, default flag, rate limits, and budget policy are validated
    And credentials are stored through approved secret references
    And the response includes hasCredential without returning the credential value

  @implemented
  Scenario: Reassign the default provider
    Given a project has multiple providers
    When an operator marks one provider as default
    Then every other provider in the same project is no longer default
    And future agents without explicit provider selection use the new default

  @planned
  Scenario: Discover provider models safely
    Given a provider is configured
    When model discovery succeeds
    Then the model catalog stores id, display name, capabilities, context limits, pricing hints, and availability
    When model discovery fails or the provider is unreachable
    Then the API returns a safe provider error without leaking credentials
    And existing provider configuration remains readable

  @implemented
  Scenario: Disable or delete a provider
    Given agents or sessions reference a provider
    When an operator disables the provider
    Then new sessions using that provider are rejected before runtime startup
    And historical sessions remain readable
    When an operator deletes an unused provider
    Then it no longer appears in provider lists
