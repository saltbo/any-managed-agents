@planned @oma-aligned @openapi
Feature: OpenAPI
  The control plane publishes an OpenAPI contract.

  Scenario: Generate OpenAPI document
    When a developer requests API documentation
    Then the document describes control-plane routes, schemas, auth, errors, and pagination

