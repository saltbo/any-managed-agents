@planned @security
Feature: Encryption
  Secret material is encrypted or stored as secret references.

  Scenario: Protect secrets at rest and in responses
    When credentials or sensitive configuration are stored
    Then raw values are never returned by APIs, events, logs, or UI views

