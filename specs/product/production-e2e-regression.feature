@implemented @e2e @auth @runtime
Feature: Production e2e regression
  Release evidence includes a real authenticated browser workflow against a
  deployed AMA origin.

  Scenario: Production and UI journey harnesses have separate ownership
    Then the e2e harness split decision documents setup responsibilities, assertions, required secrets, target origins, and cleanup
    And the production e2e harness remains API-created-resource based
    And UI-created-resource journeys remain in the browser BDD harness

  Scenario: Real browser regression is runnable with secret-backed credentials
    Then the production e2e command documents the required secret environment variables
    And the production e2e harness authenticates without direct auth database access
    And the production e2e harness creates resources through public AMA APIs
    And the production e2e harness verifies runtime chat, tool rendering, debug errors, and replay dedupe
