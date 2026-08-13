defmodule IwsdkPhoenix.OwnershipTest do
  @moduledoc """
  Ownership arbitration.

  This is the mechanism behind "picking up an object in a shared space", which
  is the most common interaction in a multiplayer WebXR scene and the one place
  where a single serialisation point is genuinely required.
  """

  use ExUnit.Case, async: true

  alias IwsdkPhoenix.Protocol
  alias IwsdkPhoenix.Room.Handler
  alias IwsdkPhoenix.Room.State

  defp room(opts \\ []) do
    state = State.new("lobby", opts)
    {state, alice} = State.join(state, "alice")
    {state, bob} = State.join(state, "bob")
    {state, alice, bob}
  end

  describe "arbitration" do
    test "grants an unowned entity to the first requester" do
      {state, alice, _bob} = room()

      {state, grant} = State.request_ownership(state, "alice", 100, 1)

      assert grant.granted
      assert grant.owner_id == alice.network_id
      assert grant.request_id == 1
      assert State.owner_of(state, 100) == alice.network_id
    end

    test "denies a second claimant and tells it who won" do
      {state, alice, _bob} = room()

      {state, _} = State.request_ownership(state, "alice", 100, 1)
      {_state, grant} = State.request_ownership(state, "bob", 100, 2)

      refute grant.granted
      # The loser learns the actual owner, not merely that it failed.
      assert grant.owner_id == alice.network_id
      assert grant.request_id == 2
    end

    test "is idempotent for the existing owner" do
      # A retry after a dropped packet must not be treated as a conflict.
      {state, alice, _bob} = room()

      {state, _} = State.request_ownership(state, "alice", 100, 1)
      {_state, grant} = State.request_ownership(state, "alice", 100, 2)

      assert grant.granted
      assert grant.owner_id == alice.network_id
    end

    test "releases an entity whose owner disconnected" do
      # Otherwise a disconnect would strand the object forever.
      {state, _alice, bob} = room()

      {state, _} = State.request_ownership(state, "alice", 100, 1)
      {state, _} = State.leave(state, "alice")

      {state, grant} = State.request_ownership(state, "bob", 100, 2)

      assert grant.granted
      assert grant.owner_id == bob.network_id
      assert State.owner_of(state, 100) == bob.network_id
    end

    test "steal_policy: :allow lets a second player take over" do
      {state, _alice, bob} = room(steal_policy: :allow)

      {state, _} = State.request_ownership(state, "alice", 100, 1)
      {state, grant} = State.request_ownership(state, "bob", 100, 2)

      assert grant.granted
      assert grant.owner_id == bob.network_id
      assert State.owner_of(state, 100) == bob.network_id
    end

    test "leaving drops ownership of everything held" do
      {state, _alice, _bob} = room()

      {state, _} = State.request_ownership(state, "alice", 100, 1)
      {state, _} = State.request_ownership(state, "alice", 101, 2)
      {state, _} = State.leave(state, "alice")

      assert State.owner_of(state, 100) == nil
      assert State.owner_of(state, 101) == nil
    end

    test "ignores a request from an unknown peer" do
      {state, _alice, _bob} = room()
      assert {^state, nil} = State.request_ownership(state, "ghost", 100, 1)
    end

    test "tracks entities independently" do
      {state, alice, bob} = room()

      {state, _} = State.request_ownership(state, "alice", 100, 1)
      {state, grant} = State.request_ownership(state, "bob", 200, 2)

      assert grant.granted
      assert State.owner_of(state, 100) == alice.network_id
      assert State.owner_of(state, 200) == bob.network_id
    end
  end

  describe "Handler integration" do
    for mode <- [:host_relayed, :server_authoritative] do
      test "arbitrates in #{mode} mode and broadcasts to everyone" do
        # Even a relayed room needs a decision point: two players grabbing the
        # same object simultaneously would otherwise both believe they won.
        state = State.new("lobby", mode: unquote(mode))
        {state, alice} = State.join(state, "alice")
        {state, _bob} = State.join(state, "bob")

        frame = Protocol.encode_ownership_request(100, 7)

        assert {:broadcast_all, payload, state} = Handler.handle_frame(state, "alice", frame)

        assert {:ok, :ownership_grant, decoded} = Protocol.decode(payload)
        assert decoded.granted
        assert decoded.owner_id == alice.network_id
        assert decoded.request_id == 7

        # And the loser's request is answered too.
        assert {:broadcast_all, payload, _state} =
                 Handler.handle_frame(state, "bob", Protocol.encode_ownership_request(100, 8))

        assert {:ok, :ownership_grant, denied} = Protocol.decode(payload)
        refute denied.granted
        assert denied.owner_id == alice.network_id
      end
    end

    test "rejects a malformed ownership request" do
      state = State.new("lobby")
      {state, _} = State.join(state, "alice")

      truncated = <<Protocol.op_ownership_request(), 1, 2>>

      assert {:error, :malformed_frame, _state} = Handler.handle_frame(state, "alice", truncated)
    end
  end
end
