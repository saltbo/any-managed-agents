@openapi @implemented
Feature: OpenAPI
  The control plane publishes an OpenAPI contract.

  Scenario: Generate OpenAPI document
    When a developer requests API documentation
    Then the document describes control-plane routes, schemas, auth, errors, and pagination
    And the OpenAPI document is generated from Hono route schemas for v1 resources
