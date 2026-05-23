@ui @auth @implemented
Feature: Login page
  Users sign in through a dedicated page.

  Scenario: Render FlareAuth sign-in action
    When the user opens the login page
    Then the page offers FlareAuth sign-in and preserves the requested return path
