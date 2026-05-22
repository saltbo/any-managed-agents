@planned @storage
Feature: Cloudflare D1 storage
  Cloudflare D1 is the required control-plane storage backend.

  Scenario: Persist control-plane data in D1
    When the platform stores organizations, projects, agents, sessions, providers, policies, vault metadata, usage, or audit records
    Then the data is persisted through Cloudflare D1
    And the Workers deployment must not require Postgres or another external relational database
