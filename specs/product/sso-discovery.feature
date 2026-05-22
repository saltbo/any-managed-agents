@planned @oma-aligned @auth @sso
Feature: SSO discovery
  Organizations can discover supported sign-in methods.

  Scenario: Discover organization login method
    When a user enters an organization identifier
    Then the platform returns available password, SSO, or provider login options

