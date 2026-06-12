@providers @governance
Feature: Provider access
  Teams and projects can restrict model providers.

  @implemented
  Scenario: Enforce provider access
    Given a provider is not allowed for a project
    When a session requests that provider
    Then the runtime rejects the request before contacting the provider

  @implemented
  Scenario: Enforce team-scoped provider access
    Given a provider is allowed only for selected teams
    And a user is not a member of any allowed team
    When the user creates a session through an agent that uses the provider
    Then the request is denied before model or sandbox work starts
    And the denial records the provider, policy rule, actor, and project without exposing credentials

  @implemented
  Scenario: Allow provider access through membership
    Given a provider is allowed for a team
    And a user is a member of that team
    When the user creates a session through an agent that uses the provider
    Then the session may start if every other policy check passes

  @implemented
  Scenario: Admin override remains auditable
    Given an organization admin uses a restricted provider
    When policy allows admin override
    Then the request succeeds
    And the audit log records that override policy was used
