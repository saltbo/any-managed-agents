@planned @ui
Feature: Layout
  The web console provides stable navigation and project context.

  Scenario: Render application shell
    When the user opens the console
    Then sidebar navigation, organization selector, project selector, and account controls are visible

