@openapi @implemented
Feature: OpenAPI
  The control plane publishes an OpenAPI contract.

  Scenario: Generate OpenAPI document
    When a developer requests API documentation
    Then the document describes control-plane routes, schemas, auth, errors, and pagination
    And the OpenAPI document is generated from Hono route schemas for v1 resources

  Scenario: Publish a restish-compatible OpenAPI document
    When an operator points restish at the platform OpenAPI URL
    Then restish can discover agents, environments, sessions, providers, vaults, governance, usage, and audit operations
    And every operation has a stable operationId, summary, tags, request schema, response schema, and error schema
    And auth schemes are declared using standard OpenAPI security definitions
    And pagination, filters, and archived-resource parameters are documented consistently

  Scenario: Keep runtime protocol separate from OpenAPI control-plane operations
    When the OpenAPI document describes session runtime endpoints
    Then it documents only the AMA proxy contract and safe examples
    And it does not define a custom replacement for Pi protocol internals
    And restish usage examples direct long-running runtime interaction to Pi-compatible helpers where appropriate
