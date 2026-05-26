@auth
Feature: Delegated identity bootstrap
  Initial users and administrator credentials are handled by FlareAuth.

  @planned
  Scenario: Delegate first admin bootstrap
    When AMA starts without local users or organizations
    Then FlareAuth remains responsible for first admin bootstrap and credential rotation
    And AMA accepts only FlareAuth OIDC identity claims for product access
