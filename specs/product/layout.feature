@ui
Feature: Layout
  The web console provides stable navigation and project context.

  @implemented
  Scenario: Render application shell
    When the user opens the console
    Then sidebar navigation, project context, organization context, and account controls are visible
