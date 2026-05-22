@planned @testing
Feature: Server tests
  Server behavior is covered by focused tests.

  Scenario: Test control-plane route
    When a control-plane route changes
    Then tests cover validation, auth, tenancy, success, and error paths

