defmodule IwsdkPhoenix do
  @moduledoc """
  Server-side WebXR multiplayer for Meta's Immersive Web SDK.

  Pairs with the npm package `@iwsdk/plugin-phoenix`. The client publishes
  compact binary frames over Phoenix Channels; this package decodes them,
  optionally simulates them authoritatively, and fans them back out with
  spatial filtering.

  ## Module map

    * `IwsdkPhoenix.Protocol` — binary codec, byte-compatible with the client
    * `IwsdkPhoenix.Protocol.Quantization` — smallest-three quaternion packing
    * `IwsdkPhoenix.SpatialGrid` — spatial hashing and area-of-interest
    * `IwsdkPhoenix.Room.State` — pure room state and id allocation
    * `IwsdkPhoenix.Room.Handler` — per-frame decisions, dependency-free
    * `IwsdkPhoenix.Room.Server` — one process per room, with the tick loop
    * `IwsdkPhoenix.RoomChannel` — thin Phoenix channel (compiled only when
      Phoenix is present)
    * `IwsdkPhoenix.Physics` — behaviour for server authority
    * `IwsdkPhoenix.Physics.Kinematic` — the default, pure-Elixir backend

  ## Optional dependencies

  Everything except `RoomChannel` works without Phoenix. `wasmex` and `horde`
  are likewise optional and only needed for the experimental WASM physics
  backend and multi-node zone handoff respectively.

  ## Getting started

      # lib/my_app_web/channels/user_socket.ex
      channel "room:*", IwsdkPhoenix.RoomChannel

  Then from the browser:

      import { installPhoenixNetworking } from '@iwsdk/plugin-phoenix';

      installPhoenixNetworking(world, {
        endpoint: 'wss://example.com/socket',
        roomId: 'lobby',
      });
  """

  @version Mix.Project.config()[:version]

  @doc "Package version."
  def version, do: @version
end
