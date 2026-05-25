@auth
Feature: Authentication flow
  Users sign in and receive a session for the control plane and runtime.

  @planned
  Scenario: Complete sign in
    When a user completes the FlareAuth OIDC callback
    Then the platform creates an httpOnly session and resolves user, organization, and project context
    And invalid FlareAuth callbacks return the standard OIDC error envelope
