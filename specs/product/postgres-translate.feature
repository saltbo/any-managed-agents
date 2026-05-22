@planned @oma-aligned @storage
Feature: Storage translation
  Storage-specific implementations preserve product behavior.

  Scenario: Keep D1 as the required Cloudflare backend
    When optional storage backends are considered
    Then Cloudflare D1 remains the deployment baseline for Workers

