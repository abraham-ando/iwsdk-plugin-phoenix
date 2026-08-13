# Deliberately no `import_deps: [:phoenix]`. It would make the formatter refuse
# to run until `mix deps.get` has succeeded, and the point of keeping it out is
# that `mix format --check-formatted` stays runnable in an environment that
# cannot reach hex.pm. The cost is parentheses on `socket/3` and `plug/1`.
[
  inputs: ["{mix,.formatter}.exs", "{config,lib,test}/**/*.{ex,exs}"]
]
