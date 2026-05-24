@ui
Feature: UI/UX standards
  The web console follows one product design system across all current and future pages.

  @implemented
  Scenario: Future console pages follow the shared UI/UX system
    Then the product UI/UX standards document defines the console style, layout, forms, states, accessibility, and responsive rules
    And the web console architecture separates app providers, routing, feature pages, shared console shell, and reusable product components
    And the shared shell keeps user controls out of the content topbar
    And feature operations stay out of the shared console context
    And the web console uses React Query for server state instead of feature-level ad hoc loading loops
    And console pages compose shadcn primitives instead of legacy custom global component classes
    And console forms use shadcn Field primitives for labels and helper text
    And console date and time rendering uses the shared dayjs formatter
    And destructive console actions require the shared confirmation dialog
    And operation feedback uses toast notifications instead of page-flow text
    And the UI/UX standards are indexed with the product specs
