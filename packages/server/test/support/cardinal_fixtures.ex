defmodule IwsdkPhoenix.CardinalFixtures do
  @moduledoc """
  Reader for `fixtures/cardinal_vectors.tsv`.

  The twin of `packages/client/test/cardinal-fixtures.ts`. Values are a flat
  run of numbers, and the component's own field order recovers the structure —
  no JSON is involved, deliberately: `jason` is an optional dependency here,
  and the core suite must run without it.
  """

  alias IwsdkPhoenix.Cardinal.Registry

  @fixture_path Path.expand("../../../../fixtures/cardinal_vectors.tsv", __DIR__)

  def fixture_path, do: @fixture_path

  @doc "Rows of one kind, kind column stripped."
  def rows(kind) do
    @fixture_path
    |> File.read!()
    |> String.split("\n", trim: true)
    |> Enum.reject(&String.starts_with?(&1, "#"))
    |> Enum.map(&String.split(&1, "\t"))
    |> Enum.filter(&match?([^kind | _], &1))
    |> Enum.map(fn [_kind | fields] -> fields end)
  end

  @doc """
  Rebuild a component struct from its id and flat field values.

  Order comes from the module's generated `field_order/0`, never from struct
  key order — Elixir sorts struct keys, and the fixture is written in
  declaration order. Slot counts come from each field's default: a map means a
  vector, a list means an array, anything else is a scalar. That keeps this
  helper free of a second copy of the schema.
  """
  def to_struct(component_id, flat) do
    # Raise rather than let a nil flow into dynamic dispatch: the type checker
    # cannot narrow `module_for/1`'s nilable return on its own, and a fixture
    # naming an unknown component is a broken fixture, not a runtime case.
    module =
      Registry.module_for(component_id) ||
        raise ArgumentError, "no component module for id #{component_id}"

    empty = struct(module)

    {fields, []} =
      Enum.reduce(module.field_order(), {%{}, flat}, fn key, {acc, remaining} ->
        {value, rest} = take_field(Map.fetch!(empty, key), remaining)
        {Map.put(acc, key, value), rest}
      end)

    struct(module, fields)
  end

  defp take_field(default, remaining) when is_map(default) and not is_struct(default) do
    keys = default |> Map.keys() |> Enum.sort_by(&vector_key_order/1)
    {taken, rest} = Enum.split(remaining, length(keys))
    {keys |> Enum.zip(Enum.map(taken, &to_float/1)) |> Map.new(), rest}
  end

  defp take_field(default, remaining) when is_list(default) do
    {taken, rest} = Enum.split(remaining, length(default))
    {Enum.map(taken, &to_number/1), rest}
  end

  defp take_field(default, [head | rest]) when is_boolean(default),
    do: {String.trim(head) == "1", rest}

  defp take_field(default, [head | rest]) when is_float(default),
    do: {to_float(head), rest}

  defp take_field(_default, [head | rest]), do: {trunc(to_number(head)), rest}

  # x, y, z, w — the order the generator flattens vectors in.
  defp vector_key_order(:x), do: 0
  defp vector_key_order(:y), do: 1
  defp vector_key_order(:z), do: 2
  defp vector_key_order(:w), do: 3

  defp to_float(text), do: text |> to_number() |> Kernel.*(1.0)

  defp to_number(text) do
    text = String.trim(text)

    case Integer.parse(text) do
      {value, ""} -> value
      _ -> text |> Float.parse() |> elem(0)
    end
  end
end
