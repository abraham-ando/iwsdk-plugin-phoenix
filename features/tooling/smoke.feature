Feature: BDD toolchain smoke test

  Scenario: The toolchain runs a scenario against a real page
    Given the demo app is running
    When I open the home page
    Then the page title is not empty
