@api
Feature: List date range filters
  Resource lists support time-based filtering.

  @planned
  Scenario: Filter API resources by date range
    Given a list route supports timestamps
    When the API client requests a date range
    Then only matching resources are returned
