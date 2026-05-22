@planned @oma-aligned @ui @api
Feature: List route pagination
  Large resource lists are paginated consistently.

  Scenario: Page through resources
    Given more resources exist than fit on one page
    When the user requests the next page
    Then the API and UI use stable cursor or page metadata

