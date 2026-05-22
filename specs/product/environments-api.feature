@planned @api @environments
Feature: Environments API
  The control plane manages reusable sandbox environments.

  Scenario: Manage environments through the API
    When a user creates, lists, updates, versions, or archives an environment
    Then responses are project-scoped and suitable for sandbox creation

