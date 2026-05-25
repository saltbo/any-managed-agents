@api
Feature: List route pagination
  Large resource lists are paginated consistently.

  @planned
  Scenario: Page through API resources
    Given more resources exist than fit on one page
    When the API client requests the next page
    Then the API uses stable cursor metadata
