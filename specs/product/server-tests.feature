@testing @implemented
Feature: Server tests
  Server behavior is covered by focused tests.

  Scenario: Test control-plane route
    When a control-plane route changes
    Then tests cover validation, auth, tenancy, success, and error paths
    And tests cover OpenAPI route schema alignment
    And Cloudflare route tests cover the v1 runtime proxy and session events
