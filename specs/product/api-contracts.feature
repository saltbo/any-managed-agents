@planned @api @openapi @cli
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

  Scenario: Generate typed clients from OpenAPI
    When a developer needs automation
    Then clients can be generated from the OpenAPI document
    And generated clients manage only control-plane resources

  Scenario: Provide a CLI for operators
    When an operator uses the CLI
    Then the CLI can manage agents, sessions, providers, vaults, governance, usage, and audit records
    And runtime session interaction still uses Cloudflare Agent SDK-compatible endpoints
