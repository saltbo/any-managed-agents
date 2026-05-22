@planned @auth
Feature: Authentication guard
  Protected routes reject unauthenticated access.

  Scenario: Guard protected resources
    When a request without a valid session accesses control-plane or agent runtime resources
    Then the platform rejects the request without returning tenant data

