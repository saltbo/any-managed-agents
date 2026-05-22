@planned @api @openapi
Feature: API contracts and automation
  Developers can automate the control plane without using a custom runtime SDK.

  Background:
    Given the platform exposes control-plane APIs under /api

  Scenario: Publish OpenAPI documentation
    When a developer requests the OpenAPI document
    Then the document describes control-plane resources, request bodies, responses, and error shapes
    And it does not describe a custom replacement for Cloudflare Agent SDK runtime traffic

  Scenario: Provide consistent API errors
    When an API request fails validation, authentication, authorization, policy, or runtime checks
    Then the response uses a stable error envelope
    And the envelope includes type, message, and safe structured details

  Scenario: Keep generated clients scoped to the control plane
    When a developer needs automation
    Then generated clients may be created from the OpenAPI document by consumers
    And this project does not maintain a product SDK for runtime interaction

  Scenario: Keep automation separate from runtime protocol
    When an operator automates agent, session, provider, vault, governance, usage, or audit management
    Then automation uses the control-plane API
    And runtime session interaction still uses Cloudflare Agent SDK-compatible endpoints
