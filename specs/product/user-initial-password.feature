@auth
Feature: Delegated identity bootstrap
  Initial users and administrator credentials are handled by OIDC provider.

  @implemented
  Scenario: Delegate first admin bootstrap
    When AMA starts without local users or organizations
    Then OIDC provider remains responsible for first admin bootstrap and credential rotation
    And AMA accepts only OIDC identity claims for product access
