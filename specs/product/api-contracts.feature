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

  Scenario: Keep OpenAPI scoped to the control plane
    When a developer uses the OpenAPI document for automation
    Then the contract covers only control-plane resources
    And runtime session interaction remains Cloudflare Agent SDK-compatible
    And the project does not maintain a generated client SDK as a product surface
