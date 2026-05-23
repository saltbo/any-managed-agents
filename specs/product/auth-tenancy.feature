@planned @control-plane @auth
Feature: Authentication and tenancy
  The platform protects both the control plane and agent runtime with the same tenant context.

  Background:
    Given an organization with a project and a user exists

  Scenario: Sign in to the control plane
    When the user signs in through FlareAuth
    Then the platform accepts the FlareAuth session
    And subsequent control-plane requests resolve the user, organization, and project

  Scenario: Reject unauthenticated control-plane access
    When a request without a valid session calls a protected API
    Then the request is rejected with 401
    And no project data is returned

  Scenario: Apply tenant context to agent runtime requests
    Given a session belongs to a project
    When the user connects through Cloudflare Agent SDK
    Then the Agent Durable Object receives the project and user context
    And the runtime rejects access from users outside the project

  Scenario: Scope resource identifiers by tenant
    When the platform creates agent runtime state
    Then Durable Object names include organization, project, and session scope
    And identifiers must not expose secrets or provider credentials
