Feature: Memory Stores
  Memory stores are project-scoped collections of session-mounted memory files.
  They are safe control-plane resources backed by D1 and attached to sessions
  through managed memory volumes.

  @memory-stores/crud @api
  Scenario: Manage memory stores and memories
    Given a project needs reusable agent memory files
    When the user creates a memory store with a name and optional description
    And adds memories with relative paths and content
    Then the store and memories are listed within the project
    And unsafe paths, duplicate paths, and cross-project access are rejected

	  @memory-stores/session-binding @api
	  Scenario: Attach memory stores to a session as managed resources
	    Given a project has an active memory store with memories
	    When the user creates a session with a memory volume and access mode
    Then the session snapshots the store name, description, managed mount path, access, and memory contents
    And callers cannot provide a memory store mount path
    And archived or cross-project stores are rejected before runtime allocation

  @memory-stores/console @web
  Scenario: Manage and attach memory stores in the console
    Given the user opens the Memory Stores console
    When they create a store, add a memory, and create a session
    Then the store can be selected in the session form with read-only or read-write access
    And the session detail shows the attached memory store without exposing memory content in the resource summary
