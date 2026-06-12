@sessions @ui
Feature: Sessions list bulk archive
  Users archive multiple sessions from the sessions list.

  @implemented
  Scenario: Bulk archive sessions
    Given multiple sessions are selected
    When the user archives them
    Then archived sessions are hidden from the default list and remain available through filters

