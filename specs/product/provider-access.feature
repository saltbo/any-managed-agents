@planned @oma-aligned @providers @governance
Feature: Provider access
  Teams and projects can restrict model providers.

  Scenario: Enforce provider access
    Given a provider is not allowed for a project
    When a session requests that provider
    Then the runtime rejects the request before contacting the provider

