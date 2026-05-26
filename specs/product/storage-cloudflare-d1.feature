@storage
Feature: Cloudflare D1 storage
  Cloudflare D1 is the required control-plane storage backend.

  @planned
  Scenario: Persist control-plane data in D1
    When the platform stores projects, agents, sessions, providers, policies, vault metadata, usage, or audit records
    Then the data is persisted through Cloudflare D1
    And the Workers deployment must not require Postgres or another external relational database

  @planned
  Scenario: Run on Cloudflare Workers runtime bindings
    When the platform runs in Cloudflare
    Then control-plane requests use Worker routing
    And session state uses Durable Object and D1 bindings
    And the deployment does not require a separate Node server
