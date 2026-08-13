defmodule IwsdkPhoenix.TestFixtures do
  @moduledoc """
  Reader for the cross-language golden vectors in `fixtures/protocol_vectors.tsv`.

  The file is generated from the TypeScript implementation. Parsing it here with
  a few lines of `String.split/2` rather than a JSON library is what lets the
  core suite keep its no-dependency property — see the `IWSDK_CORE_ONLY` note in
  `mix.exs`.
  """

  @fixture_path Path.expand("../../../../fixtures/protocol_vectors.tsv", __DIR__)

  @doc "Absolute path to the shared fixture file."
  def fixture_path, do: @fixture_path

  @doc "True when the fixture file is present."
  def available?, do: File.exists?(@fixture_path)

  @doc """
  Load the fixture as a list of `{kind, fields}` tuples, comments stripped.

  Order is preserved, which matters: a `snapshot` row is followed by its
  `record` rows.
  """
  @spec load() :: [{String.t(), [String.t()]}]
  def load do
    @fixture_path
    |> File.read!()
    |> String.split("\n", trim: true)
    |> Enum.reject(&(String.starts_with?(&1, "#") or &1 == ""))
    |> Enum.map(fn line ->
      [kind | fields] = String.split(line, "\t")
      {kind, fields}
    end)
  end

  @doc "All rows of a given kind."
  @spec rows(String.t()) :: [[String.t()]]
  def rows(kind) do
    load()
    |> Enum.filter(fn {row_kind, _fields} -> row_kind == kind end)
    |> Enum.map(fn {_kind, fields} -> fields end)
  end

  @doc """
  Snapshot rows paired with the record rows that follow them.

  Returns `[{fields, [record_fields]}]`.
  """
  @spec snapshots() :: [{[String.t()], [[String.t()]]}]
  def snapshots do
    load()
    |> Enum.chunk_while(
      nil,
      fn
        {"snapshot", fields}, nil -> {:cont, {fields, []}}
        {"snapshot", fields}, acc -> {:cont, finish(acc), {fields, []}}
        {"record", fields}, {snapshot, records} -> {:cont, {snapshot, [fields | records]}}
        _other, acc -> {:cont, acc}
      end,
      fn
        nil -> {:cont, nil}
        acc -> {:cont, finish(acc), nil}
      end
    )
    |> Enum.reject(&is_nil/1)
  end

  defp finish({snapshot, records}), do: {snapshot, Enum.reverse(records)}

  @doc "Parse a fixture float."
  @spec to_float(String.t()) :: float()
  def to_float(text), do: text |> String.trim() |> Float.parse() |> elem(0)

  @doc "Parse a fixture integer."
  @spec to_integer(String.t()) :: integer()
  def to_integer(text), do: text |> String.trim() |> String.to_integer()

  @doc "Decode a lowercase-hex field into a binary."
  @spec from_hex(String.t()) :: binary()
  def from_hex(hex), do: Base.decode16!(String.trim(hex), case: :lower)

  @doc "Encode a binary as lowercase hex."
  @spec to_hex(binary()) :: String.t()
  def to_hex(binary), do: Base.encode16(binary, case: :lower)

  @doc "Build a vec3 from three fixture fields."
  def vec3(x, y, z), do: %{x: to_float(x), y: to_float(y), z: to_float(z)}

  @doc "Build a quaternion from four fixture fields."
  def quat(x, y, z, w),
    do: %{x: to_float(x), y: to_float(y), z: to_float(z), w: to_float(w)}
end
