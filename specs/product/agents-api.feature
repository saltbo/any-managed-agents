@planned @api @agents
Feature: Agents API
  The control plane exposes APIs for project-scoped agent definitions.

  Scenario: Manage agent definitions through the API
    Given an authenticated project user
    When the user creates, lists, reads, updates, versions, or archives an agent
    Then each response is scoped to the user's organization and project

