@implemented @ui @sessions
Feature: Console layout hardening
  Console tables and session detail use the deployed compact layout.

  Scenario: Session detail uses a full-bleed compact shell
    When the user opens the session detail page
    Then the session detail route removes the contained console shell padding
    And the session composer is compact and bottom aligned
    And transcript error details use the shared tooltip surface

  Scenario: Resource lists use adaptive pagination
    When the user opens a resource list page
    Then resource tables use a viewport ref with an adaptive pagination footer
    And resource list rows keep primary metadata on one line
    And provider and MCP error details use the shared tooltip surface
