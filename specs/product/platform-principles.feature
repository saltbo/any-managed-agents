Feature: Platform principles
  Any Managed Agents is a Cloudflare-native managed agents system.
  It borrows the managed agent product model from CMA and Claude Managed Agents,
  but it is not bound to Anthropic or any single model provider.

  Background:
    Given the platform is designed as a self-hostable Cloudflare Workers application

  Scenario: The platform can be deployed on Cloudflare
    Then the application must run on Cloudflare Workers
    And the application must use Cloudflare-compatible platform services for runtime state

  Scenario: Agent runtime uses Cloudflare Agent SDK
    Then agent runtime traffic must use the Cloudflare Agent SDK protocol
    And the platform must not define a competing custom agent runtime SDK
    And product APIs may exist only for control-plane resource management

  Scenario: Product SDK manages platform resources
    Then the platform must provide a thin Any Managed Agents SDK
    And the SDK must manage agents, environments, sessions, providers, vaults, governance, usage, and audit resources
    And runtime helpers in the SDK must delegate to Cloudflare Agent SDK-compatible endpoints

  Scenario: Sandbox execution uses Cloudflare Sandbox SDK
    Then sandbox execution must use Cloudflare Sandbox SDK
    And the platform must not define a competing custom sandbox SDK

  Scenario: Model providers are not vendor locked
    Then Workers AI must be supported as a first-class model provider
    And Anthropic must not be required for the platform to operate
    And the model layer must allow additional providers

  Scenario: BDD specs are the agent-facing acceptance contract
    Then BDD specs must describe product and platform behavior
    And implementation work must be validated against the BDD specs
    And BDD specs are not the primary end-user interface
