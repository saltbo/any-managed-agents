@planned @api @openapi
Feature: API contracts and automation
  Developers can automate the control plane through a thin product SDK.

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

  Scenario: Generate the product SDK from the API contract
    When a developer installs the Any Managed Agents SDK
    Then the SDK manages agents, environments, sessions, providers, vaults, governance, usage, and audit resources
    And the SDK is generated from or mechanically aligned with the OpenAPI document where possible
    And the SDK does not define a replacement runtime protocol

  Scenario: Keep automation separate from runtime protocol
    When an operator automates agent, session, provider, vault, governance, usage, or audit management
    Then automation uses the Any Managed Agents SDK or the control-plane API
    And runtime session interaction still uses Cloudflare Agent SDK-compatible endpoints
