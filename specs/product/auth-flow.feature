@planned @auth
Feature: Authentication flow
  Users sign in and receive a session for the control plane and runtime.

  Scenario: Complete sign in
    When a user signs in with valid credentials
    Then the platform creates an httpOnly session and resolves user, organization, and project context

