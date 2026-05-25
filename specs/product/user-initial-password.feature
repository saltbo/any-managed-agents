@auth
Feature: User initial password
  Initial admin credentials are handled safely.

  @planned
  Scenario: Bootstrap first admin
    When the platform starts without users
    Then an initial admin can be created through a secure bootstrap flow and must rotate default credentials

