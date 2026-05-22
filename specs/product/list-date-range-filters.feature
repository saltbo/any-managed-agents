@planned @ui
Feature: List date range filters
  Resource lists support time-based filtering.

  Scenario: Filter by date range
    Given a list page supports timestamps
    When the user selects a date range
    Then only matching resources are shown and the URL preserves the filter

