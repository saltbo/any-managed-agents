@auth @implemented
Feature: Authentication
  The platform integrates with FlareAuth and applies tenant context.

  Scenario: Resolve authenticated context
    Given FlareAuth can issue a valid user session
    When the user requests their auth context
    Then the request context includes user, organization, project, roles, and permissions
    And protected APIs reject missing or invalid sessions with the standard error envelope
