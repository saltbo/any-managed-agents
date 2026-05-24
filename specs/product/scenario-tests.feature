@testing @implemented
Feature: Scenario tests
  Product scenarios validate end-to-end behavior.

  Scenario: Run scenario test
    Given a scenario test is defined
    When CI executes the scenario
    Then the test verifies user-visible behavior and runtime side effects
    And implemented product scenarios are not excluded with planned tags
    And mocked browser scenario evidence covers desktop and 390px mobile workflows
