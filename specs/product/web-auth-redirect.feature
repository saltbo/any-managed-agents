@planned @oma-aligned @web @auth
Feature: Web auth redirect
  The web app redirects users based on authentication state.

  Scenario: Redirect unauthenticated user
    When an unauthenticated user opens a protected page
    Then the app redirects to login and returns to the original page after sign in

