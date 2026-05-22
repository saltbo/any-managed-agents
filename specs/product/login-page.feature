@planned @oma-aligned @ui @auth
Feature: Login page
  Users sign in through a dedicated page.

  Scenario: Render login form
    When the user opens the login page
    Then the form supports credentials, validation errors, and redirect after successful sign in

