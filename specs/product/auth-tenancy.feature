@control-plane @auth
Feature: Authentication and tenancy
  The platform protects both the control plane and agent runtime with the same tenant context.

  Background:
    Given an organization with a project and a user exists

  @planned
  Scenario: Sign in to the control plane
    When the user signs in through OIDC provider
    Then the platform accepts the OIDC session
    And subsequent control-plane requests resolve the user, organization, and project

  @planned
  Scenario: Reject unauthenticated control-plane access
    When a request without a valid session calls a protected API
    Then the request is rejected with 401
    And no project data is returned

  @planned
  Scenario: Apply tenant context to agent runtime requests
    Given a session belongs to a project
    When the user connects through the AMA runtime proxy
    Then the AMA runtime proxy resolves the project and user context
    And AMA rejects access from users outside the project before forwarding to the selected environment runtime

  @planned
  Scenario: Scope resource identifiers by tenant
    When the platform creates agent runtime state
    Then Durable Object names include organization, project, and session scope
    And identifiers must not expose secrets or provider credentials
