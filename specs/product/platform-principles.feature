Feature: Platform principles
  Any Managed Agents is a Cloudflare-native managed agents system.
  It borrows the managed agent product model from CMA and Claude Managed Agents,
  but it is not bound to Anthropic or any single model provider.

  Background:
    Given the platform is designed as a self-hostable Cloudflare Workers application

  Scenario: The platform can be deployed on Cloudflare
    Then the application must run on Cloudflare Workers
    And the application must use Cloudflare-compatible platform services for control-plane state

  Scenario: Agent runtime uses Pi in Cloudflare Sandbox
    Then agent runtime traffic must use Pi protocol through Cloudflare Sandbox
    And the platform must not define a competing custom agent runtime protocol
    And product APIs may exist only for control-plane resource management

  Scenario: OpenAPI is the SDK contract boundary
    Then this repository must publish the Any Managed Agents OpenAPI contract
    And this repository must not maintain language SDK source code
    And external SDK runtime helpers must delegate to Pi runtime endpoints

  Scenario: Sandbox execution uses Cloudflare Sandbox
    Then sandbox execution must use Cloudflare Sandbox
    And the platform must not define a competing custom sandbox SDK

  Scenario: Model providers are not vendor locked
    Then Workers AI must be supported as a first-class model provider
    And Anthropic must not be required for the platform to operate
    And the model layer must support all configured providers

  Scenario: BDD specs are the agent-facing acceptance contract
    Then BDD specs must describe product and platform behavior
    And implementation work must be validated against the BDD specs
    And BDD specs are not the primary end-user interface
