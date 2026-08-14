defmodule IwsdkPhoenix.Cardinal.Cache do
  @moduledoc """
  Latest value per `{network_id, component_id}`, for late joiners.

  Without this a peer that arrives after a component was last published never
  learns its value — it would see only future changes, and an object's health
  or hold state would stay at its default until something happened to it.

  What a value *is* depends on the room's mode, and the difference is load
  bearing. In a relayed room the server has no business decoding anything:
  `docs/ARCHITECTURE.md` documents a zero-decode relay path, and the cache
  keeps raw payload binaries so that stays true. In an authoritative room the
  server's own logic reads these values, so they are stored as the generated
  structs.
  """

  alias IwsdkPhoenix.Cardinal.Registry
  alias IwsdkPhoenix.Protocol

  @typedoc "network_id => component_id => raw payload or generated struct"
  @type t :: %{pos_integer() => %{pos_integer() => binary() | struct()}}

  @spec new() :: t()
  def new, do: %{}

  @doc "Record every value in `records`, newest wins."
  @spec put(t(), :host_relayed | :server_authoritative, [map()]) :: t()
  def put(cache, mode, records) do
    Enum.reduce(records, cache, fn record, acc ->
      case value_for(mode, record) do
        :skip ->
          acc

        value ->
          Map.update(
            acc,
            record.network_id,
            %{record.component_id => value},
            &Map.put(&1, record.component_id, value)
          )
      end
    end)
  end

  defp value_for(:host_relayed, record), do: record.payload

  defp value_for(:server_authoritative, record) do
    case Registry.module_for(record.component_id) do
      nil ->
        :skip

      module ->
        case module.decode(record.payload) do
          {:ok, struct} -> struct
          # A payload that will not decode is a client bug; caching it would
          # replay the same bug to every future joiner.
          :error -> :skip
        end
    end
  end

  @spec get(t(), pos_integer(), pos_integer()) :: binary() | struct() | nil
  def get(cache, network_id, component_id) do
    cache |> Map.get(network_id, %{}) |> Map.get(component_id)
  end

  @spec drop_entity(t(), pos_integer()) :: t()
  def drop_entity(cache, network_id), do: Map.delete(cache, network_id)

  @doc """
  Frames replaying the whole cache, or `[]` when there is nothing to replay.

  One frame for everything: batching is what keeps these binaries above the
  BEAM's 64-byte copy threshold, and a joining peer should not receive one
  small message per component.
  """
  @spec frames(t(), non_neg_integer()) :: [binary()]
  def frames(cache, server_tick) do
    records =
      for {network_id, components} <- cache,
          {component_id, value} <- components do
        %{
          network_id: network_id,
          component_id: component_id,
          payload: to_payload(component_id, value)
        }
      end

    case records do
      [] -> []
      _ -> [Protocol.encode_component_update(records, server_tick)]
    end
  end

  defp to_payload(_component_id, value) when is_binary(value), do: value

  # The struct's own module is the encoder — no registry lookup needed, and
  # binding it from the pattern gives a module the type checker can trust.
  defp to_payload(_component_id, %module{} = value), do: module.encode(value)
end
