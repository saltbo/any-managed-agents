@planned @auth
Feature: Authentication
  The platform integrates with FlareAuth and applies tenant context.

  Scenario: Resolve authenticated context
    Given FlareAuth has issued a valid user session
    When the user calls the API
    Then the request context includes user, organization, project, roles, and permissions
