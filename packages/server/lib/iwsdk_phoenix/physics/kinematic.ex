defmodule IwsdkPhoenix.Physics.Kinematic do
  @moduledoc """
  Deterministic kinematic authority in pure Elixir. The default backend.

  ## Parity with the client

  `apply_input/3` implements exactly the integration step performed by
  `ClientPredictionSystem.applyInput` in the TypeScript package:

      sin      = sin(yaw)
      cos      = cos(yaw)
      world_x  =  movement.x * cos + movement.y * sin
      world_z  = -movement.x * sin + movement.y * cos
      x        = x + world_x * speed * dt
      z        = z - world_z * speed * dt

  This is the whole point of the design. Because both sides run the same
  formula, a client that is behaving honestly predicts the server's result
  exactly, its reconciliation error stays at zero, and the player never sees a
  correction. Divergence therefore means either genuine packet loss or a client
  that is lying — which is precisely the signal an anti-cheat check wants.

  The shared `test/fixtures/protocol_vectors.json` file pins this equivalence
  so the two implementations cannot drift apart silently.

  ## What it validates

    * **Speed** — movement axes are clamped to the unit disc before
      integration, so a client sending `movement: {x: 1000, y: 1000}` moves at
      exactly the same speed as one sending `{x: 0, y: 1}`.
    * **Timestep** — `delta_ms` is clamped to `max_delta_ms`. Without this a
      client could claim a single 10-second frame and cross the map in one
      packet.
    * **Bounds** — an optional axis-aligned box the player cannot leave.

  It deliberately does *not* do collision detection against scene geometry;
  that needs the actual level, and is what a real physics backend is for.
  """

  @behaviour IwsdkPhoenix.Physics

  defstruct move_speed: 4.5,
            max_delta_ms: 100,
            bounds: nil

  @type t :: %__MODULE__{
          move_speed: float(),
          max_delta_ms: non_neg_integer(),
          bounds: nil | %{min: map(), max: map()}
        }

  @impl true
  def init(opts \\ []) do
    {:ok,
     %__MODULE__{
       move_speed: Keyword.get(opts, :move_speed, 4.5),
       max_delta_ms: Keyword.get(opts, :max_delta_ms, 100),
       bounds: Keyword.get(opts, :bounds)
     }}
  end

  @impl true
  def apply_input(player, input, %__MODULE__{} = config) do
    # Ignore replays and out-of-order input: a sequence we have already
    # consumed must never move the player a second time.
    if input.sequence <= player.last_sequence do
      {player, config}
    else
      {x, z} =
        integrate(
          player.position.x,
          player.position.z,
          input.movement.x,
          input.movement.y,
          input.yaw,
          input.delta_ms / 1000,
          config.move_speed,
          config.max_delta_ms
        )

      position = apply_bounds(%{x: x, y: player.position.y, z: z}, config.bounds)

      {%{player | position: position, last_sequence: input.sequence}, config}
    end
  end

  @doc """
  Integrate one movement input in the player's yaw frame.

  The Elixir twin of `integrateMovement` in
  `@iwsdk/plugin-phoenix/src/math/movement.ts`. Both are pinned to the same
  golden vectors in `fixtures/protocol_vectors.tsv`, because a divergence here
  would not fail loudly — it would just produce an endless drizzle of
  corrections that are painful to trace back to their cause.

  ## Examples

      iex> IwsdkPhoenix.Physics.Kinematic.integrate(0.0, 0.0, 0.0, 1.0, 0.0, 0.1, 10.0, 100)
      {0.0, -1.0}
  """
  @spec integrate(float(), float(), number(), number(), number(), number(), number(), number()) ::
          {float(), float()}
  def integrate(x, z, movement_x, movement_y, yaw, delta_seconds, speed, max_delta_ms \\ 100) do
    {clamped_x, clamped_y} = clamp_to_unit_disc(movement_x, movement_y)
    step = min(delta_seconds, max_delta_ms / 1000)

    sin = :math.sin(yaw)
    cos = :math.cos(yaw)

    # Right/forward basis from yaw; movement_y drives -Z, forward in Three.js's
    # right-handed, Y-up convention.
    world_x = clamped_x * cos + clamped_y * sin
    world_z = -clamped_x * sin + clamped_y * cos

    {x + world_x * speed * step, z - world_z * speed * step}
  end

  @impl true
  def step(config, _delta_seconds), do: config

  @doc """
  Clamp a movement vector into the unit disc.

  Clamping to the *disc* rather than per-axis matters: clamping each axis to
  `[-1, 1]` independently still allows `{1, 1}`, whose magnitude is `sqrt(2)`.
  That is the classic diagonal speed exploit, and it hands a 41% speed
  advantage to anyone who holds two directions at once.

  ## Examples

      iex> IwsdkPhoenix.Physics.Kinematic.clamp_to_unit_disc(0.0, 1.0)
      {0.0, 1.0}

      iex> {x, y} = IwsdkPhoenix.Physics.Kinematic.clamp_to_unit_disc(1.0, 1.0)
      iex> Float.round(:math.sqrt(x * x + y * y), 6)
      1.0
  """
  @spec clamp_to_unit_disc(number(), number()) :: {float(), float()}
  def clamp_to_unit_disc(x, y) do
    magnitude = :math.sqrt(x * x + y * y)

    if magnitude > 1.0 do
      {x / magnitude, y / magnitude}
    else
      {x / 1, y / 1}
    end
  end

  defp apply_bounds(position, nil), do: position

  defp apply_bounds(position, %{min: min_bound, max: max_bound}) do
    %{
      x: position.x |> max(min_bound.x) |> min(max_bound.x),
      y: position.y |> max(min_bound.y) |> min(max_bound.y),
      z: position.z |> max(min_bound.z) |> min(max_bound.z)
    }
  end
end
