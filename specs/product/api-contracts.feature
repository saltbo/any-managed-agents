@api @openapi
Feature: API contracts and automation
  Developers can automate the control plane through OpenAPI and external SDKs.

  Background:
    Given the platform exposes control-plane APIs under /api

  @implemented
  Scenario: Publish OpenAPI documentation
    When a developer requests the OpenAPI document
    Then the document describes control-plane resources, request bodies, responses, and error shapes
    And the document is generated from Hono route schemas instead of hand-written OpenAPI JSON
    And it does not describe a custom replacement for AMA session traffic

  @implemented
  Scenario: Provide consistent API errors
    When an API request fails validation, authentication, authorization, policy, or runtime checks
    Then the response uses a stable error envelope
    And the envelope includes type, message, and safe structured details

  @planned
  Scenario: Generate external SDKs from the API contract
    When a developer installs an Any Managed Agents SDK from this repository's generated SDK layout
    Then the SDK manages agents, environments, sessions, providers, vaults, governance, usage, and audit resources
    And the SDK is generated from or mechanically aligned with this repository's OpenAPI document
    And the SDKs do not define a replacement runtime protocol

  @planned
  Scenario: Keep automation separate from runtime protocol
    When an operator automates agent, session, provider, vault, governance, usage, or audit management
    Then automation uses an external Any Managed Agents SDK or the control-plane API
    And runtime session interaction still uses AMA runtime endpoints

  @planned
  Scenario: Support restish as the default CLI path
    When an operator wants command-line access to the control plane
    Then the platform recommends restish against the published OpenAPI document instead of a bespoke CLI implementation
    And the OpenAPI document remains the single source of truth for command discovery, request fields, response fields, and auth
    And examples include a restish profile configured for the current deployment origin

  @planned
  Scenario: Provide an agent skill for CLI workflows
    When an automation agent needs to operate AMA from a terminal
    Then the project provides a skill that teaches the agent how to configure and use restish with the AMA OpenAPI document
    And the skill covers common workflows for agents, environments, sessions, providers, vaults, governance, usage, and audit
    And the skill instructs runtime message interaction to use AMA runtime endpoints rather than inventing a separate CLI protocol
