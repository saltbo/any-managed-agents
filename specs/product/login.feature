@planned @auth
Feature: Login
  Login creates a secure user session.

  Scenario: Login with valid credentials
    When credentials are valid
    Then the platform creates an httpOnly session and returns the default organization and project

