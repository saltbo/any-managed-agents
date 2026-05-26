@ui @auth
Feature: Login page
  Users sign in through a dedicated page.

  @implemented
  Scenario: Render OIDC provider sign-in action
    When the user opens the login page
    Then the page offers OIDC provider sign-in and preserves the requested return path
