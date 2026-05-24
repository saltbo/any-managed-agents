@skill @cli @implemented
Feature: Agent skill for AMA command-line workflows
  Automation agents use a skill to operate AMA through restish and the OpenAPI contract.

  Scenario: Skill documents restish setup
    Given an agent has access to the AMA repository or deployment docs
    When the agent loads the AMA CLI skill
    Then the skill explains how to install or invoke restish
    And how to configure the AMA OpenAPI document URL, API base URL, and authentication
    And how to verify discovery with the health operation

  Scenario: Skill maps common workflows to OpenAPI operations
    When an agent needs to manage AMA resources from a terminal
    Then the skill shows restish workflows for agents, environments, sessions, providers, vaults, governance, usage, and audit
    And each workflow references OpenAPI operation names or documented paths rather than hard-coded bespoke CLI commands
    And destructive workflows call out confirmation and archive-versus-delete semantics

  Scenario: Skill preserves runtime protocol boundaries
    Given an agent needs to send work to a running session
    When the skill describes session runtime interaction
    Then it uses AMA runtime endpoints or Pi-compatible helpers
    And it does not define a new CLI-level runtime protocol
