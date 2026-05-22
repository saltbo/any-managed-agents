@planned @oma-aligned @auth
Feature: Authentication
  The platform authenticates users and applies tenant context.

  Scenario: Resolve authenticated context
    Given a valid session exists
    When the user calls the API
    Then the request context includes user, organization, project, roles, and permissions

