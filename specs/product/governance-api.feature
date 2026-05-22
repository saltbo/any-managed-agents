@planned @api @governance
Feature: Governance API
  Operators manage governance policy through the control plane.

  Scenario: Update governance policy
    When an operator saves provider, model, tool, sandbox, or budget policy
    Then the platform validates and applies the policy to later sessions

