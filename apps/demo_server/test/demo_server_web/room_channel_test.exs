defmodule DemoServerWeb.RoomChannelTest do
  @moduledoc """
  `IwsdkPhoenix.RoomChannel` driven through a real Phoenix socket.

  This is the coverage the library package cannot have. `iwsdk_phoenix` keeps
  every decision in dependency-free modules precisely so it can be tested
  without Phoenix, which leaves the channel itself — join, discovery, routing,
  departure — resting on reasoning rather than on a test. Everything here failed
  in some form before this app existed:

    * each socket built its own room, so both peers were allocated id 1
    * nothing announced a peer's arrival, so nobody ever saw anybody
    * nothing subscribed a socket to its own topic, so directed signalling went
      nowhere at all

  Every test uses a room of its own; see `DemoServerWeb.ChannelCase`.
  """

  use DemoServerWeb.ChannelCase, async: true

  alias IwsdkPhoenix.Protocol

  describe "join" do
    test "replies with the peer's identity" do
      {_socket, reply} = join_room("alice", unique_room())

      assert reply.peer_id == "alice"
      assert is_integer(reply.network_id) and reply.network_id > 0
      assert reply.mode == :host_relayed
    end

    test "gives two peers in one room different network ids" do
      # The property the room process exists for. With per-socket state both
      # peers were handed id 1, and every frame either published was applied to
      # the other's own avatar.
      room = unique_room()

      {_alice, alice_reply} = join_room("alice", room)
      {_bob, bob_reply} = join_room("bob", room)

      refute alice_reply.network_id == bob_reply.network_id
    end

    test "gives peers in different rooms independent ids" do
      {_alice, alice_reply} = join_room("alice", unique_room())
      {_bob, bob_reply} = join_room("bob", unique_room())

      # Not an accident worth hiding: separate rooms are separate allocators, so
      # the same id in two rooms refers to two different people.
      assert alice_reply.network_id == bob_reply.network_id
    end

    test "a peer rejoining keeps its id" do
      room = unique_room()

      {_first, first_reply} = join_room("alice", room)
      {_second, second_reply} = join_room("alice", room)

      assert first_reply.network_id == second_reply.network_id
    end

    test "reports the room's mode, not the one requested" do
      # A room already holding players cannot change its authority model under
      # them, so the second joiner is told what it actually got.
      room = unique_room()

      {_alice, alice_reply} = join_room("alice", room, %{"mode" => "server_authoritative"})
      {_bob, bob_reply} = join_room("bob", room, %{"mode" => "host_relayed"})

      assert alice_reply.mode == :server_authoritative
      assert bob_reply.mode == :server_authoritative
    end

    test "refuses an unknown mode" do
      assert {:error, %{reason: "unsupported_mode"}} =
               DemoServerWeb.UserSocket
               |> socket("alice", %{peer_id: "alice"})
               |> subscribe_and_join("room:#{unique_room()}", %{"mode" => "peer_to_peer"})
    end
  end

  describe "discovery" do
    test "both peers learn about each other" do
      # Two halves, both required. The broadcast alone leaves a late joiner
      # blind to everyone already present; the roster replay alone leaves
      # everyone present blind to the newcomer.
      room = unique_room()

      {_alice, alice_reply} = join_room("alice", room)
      {_bob, bob_reply} = join_room("bob", room)

      spawns = drain_frames() |> of_kind(:spawn_entity) |> Enum.map(& &1.network_id)

      assert bob_reply.network_id in spawns, "alice was never told bob arrived"
      assert alice_reply.network_id in spawns, "bob was never told alice was here"
    end

    test "spawns a peer under the avatar prefab" do
      room = unique_room()

      {_alice, _} = join_room("alice", room)
      {_bob, bob_reply} = join_room("bob", room)

      [spawn_frame] =
        drain_frames()
        |> of_kind(:spawn_entity)
        |> Enum.filter(&(&1.network_id == bob_reply.network_id))
        |> Enum.take(1)

      assert spawn_frame.prefab_id == 0
      # A peer owns its own avatar; nothing else may publish its transform.
      assert spawn_frame.owner_id == bob_reply.network_id
    end

    test "a third peer is announced to both of the first two" do
      room = unique_room()

      {_alice, alice_reply} = join_room("alice", room)
      {_bob, bob_reply} = join_room("bob", room)
      drain_frames()

      {_carol, carol_reply} = join_room("carol", room)

      spawns = drain_frames() |> of_kind(:spawn_entity) |> Enum.map(& &1.network_id)

      # Carol's arrival reaches the room, and carol is replayed the two peers
      # already in it.
      assert carol_reply.network_id in spawns
      assert alice_reply.network_id in spawns
      assert bob_reply.network_id in spawns
    end

    test "a departing peer is despawned" do
      room = unique_room()

      {_alice, _alice_reply} = join_room("alice", room)
      {bob, bob_reply} = join_room("bob", room)
      drain_frames()

      # `leave/1` stops the channel with reason `:left`, and ChannelTest links
      # the channel to the test process — so without unlinking first, that exit
      # takes the test down with it before any assertion runs.
      Process.unlink(bob.channel_pid)

      # Wait for the channel to actually die: the despawn is broadcast from
      # `terminate/2`, so draining before then would be a race.
      reference = Process.monitor(bob.channel_pid)
      leave(bob)
      assert_receive {:DOWN, ^reference, :process, _pid, _reason}, 1_000

      despawned = drain_frames() |> of_kind(:despawn_entity) |> Enum.map(& &1.network_id)

      assert bob_reply.network_id in despawned
    end
  end

  describe "relaying" do
    test "forwards a transform to the other peer and not back to its sender" do
      room = unique_room()

      {alice, alice_reply} = join_room("alice", room)
      {_bob, _bob_reply} = join_room("bob", room)
      drain_frames()

      frame =
        Protocol.encode_transform(
          alice_reply.network_id,
          %{x: 1.0, y: 2.0, z: 3.0},
          %{x: 0.0, y: 0.0, z: 0.0, w: 1.0}
        )

      push(alice, "frame", {:binary, frame})

      transforms = drain_frames() |> of_kind(:transform_update)

      # Exactly one delivery: to bob. A frame echoed back to its sender would
      # fight that client's own prediction.
      assert [%{network_id: id, position: position}] = transforms
      assert id == alice_reply.network_id
      assert_in_delta position.x, 1.0, 0.0001
      assert_in_delta position.y, 2.0, 0.0001
      assert_in_delta position.z, 3.0, 0.0001
    end

    test "rejects a JSON payload on the binary event" do
      # A client that is not speaking this protocol. Saying so is better than
      # dropping the frame, which is indistinguishable from packet loss.
      {alice, _reply} = join_room("alice", unique_room())

      reference = push(alice, "frame", %{"x" => 1})

      assert_reply(reference, :error, %{reason: "expected_binary_payload"})
    end

    test "answers a ping with the extended pong a clock estimate needs" do
      IwsdkPhoenix.Clock.put_epoch(777)
      {alice, _reply} = join_room("alice", unique_room())

      reference = push(alice, "frame", {:binary, Protocol.encode_ping(1234.5)})

      assert_reply(reference, :ok, {:binary, pong})
      assert byte_size(pong) == 29

      assert {:ok, :pong, %{timestamp: timestamp, t1: t1, t2: t2, epoch: 777}} =
               Protocol.decode(pong)

      # The echo is what lets a client match a reply to the ping it sent, and
      # refuse a sample it cannot attribute.
      assert_in_delta timestamp, 1234.5, 0.0001
      # Receive before send, or the offset formula is being fed nonsense.
      assert t1 <= t2
    end

    test "relays a component update to the other peer" do
      room = unique_room()
      {alice, alice_reply} = join_room("alice", room)
      {_bob, _bob_reply} = join_room("bob", room)
      drain_frames()

      frame =
        Protocol.encode_component_update(
          [
            %{
              network_id: alice_reply.network_id,
              component_id: 1,
              payload: IwsdkPhoenix.Cardinal.Health.encode(%IwsdkPhoenix.Cardinal.Health{
                current: 50.0,
                max: 100.0
              })
            }
          ],
          0
        )

      push(alice, "frame", {:binary, frame})

      records =
        drain_frames()
        |> of_kind(:component_update)
        |> Enum.flat_map(& &1.records)

      assert Enum.any?(records, &(&1.network_id == alice_reply.network_id))
    end

    test "a late joiner receives the cached component state" do
      # The whole point of the cache: without it bob would only ever see
      # Health if alice happened to publish again after he arrived.
      room = unique_room()
      {alice, alice_reply} = join_room("alice", room)

      push(
        alice,
        "frame",
        {:binary,
         Protocol.encode_component_update(
           [
             %{
               network_id: alice_reply.network_id,
               component_id: 1,
               payload:
                 IwsdkPhoenix.Cardinal.Health.encode(%IwsdkPhoenix.Cardinal.Health{
                   current: 50.0,
                   max: 100.0
                 })
             }
           ],
           0
         )}
      )

      drain_frames()
      {_bob, _bob_reply} = join_room("bob", room)

      records =
        drain_frames()
        |> of_kind(:component_update)
        |> Enum.flat_map(& &1.records)

      assert Enum.any?(records, &(&1.network_id == alice_reply.network_id))
    end

    test "an authoritative room rejects a client-published component" do
      # The mode's premise: the client sends inputs, the server decides what is
      # true. Rejecting rather than ignoring makes a misconfigured client
      # obvious — the same choice the transform path already makes.
      {alice, _reply} =
        join_room("alice", unique_room(), %{"mode" => "server_authoritative"})

      reference =
        push(
          alice,
          "frame",
          {:binary,
           Protocol.encode_component_update(
             [
               %{
                 network_id: 1,
                 component_id: 1,
                 payload:
                   IwsdkPhoenix.Cardinal.Health.encode(%IwsdkPhoenix.Cardinal.Health{
                     current: 50.0,
                     max: 100.0
                   })
               }
             ],
             0
           )}
        )

      assert_reply(reference, :error, %{reason: "client_authority_denied"})
    end

    test "refuses a join whose schema hash does not match" do
      assert {:error, %{reason: "schema_mismatch"}} =
               DemoServerWeb.UserSocket
               |> socket("mallory", %{peer_id: "mallory"})
               |> subscribe_and_join(
                 IwsdkPhoenix.RoomChannel,
                 "room:#{unique_room()}",
                 %{"mode" => "host_relayed", "schema_hash" => "deadbeef"}
               )
    end

    test "accepts a join carrying the matching schema hash" do
      {_socket, reply} =
        join_room("alice", unique_room(), %{
          "schema_hash" => IwsdkPhoenix.Cardinal.Registry.schema_hash()
        })

      assert reply.peer_id == "alice"
    end

    test "accepts a join with no schema hash at all" do
      # An application using no Cardinal components should not have to know
      # this field exists.
      {_socket, reply} = join_room("alice", unique_room())
      assert reply.peer_id == "alice"
    end

    test "a swapped epoch shows up on the very next pong" do
      # The restart-and-handoff scenario, without restarting anything: the
      # epoch is what tells a client its offset estimate has become fiction.
      {alice, _reply} = join_room("alice", unique_room())

      IwsdkPhoenix.Clock.put_epoch(1)
      reference = push(alice, "frame", {:binary, Protocol.encode_ping(1.0)})
      assert_reply(reference, :ok, {:binary, first})
      assert {:ok, :pong, %{epoch: 1}} = Protocol.decode(first)

      IwsdkPhoenix.Clock.put_epoch(2)
      reference = push(alice, "frame", {:binary, Protocol.encode_ping(2.0)})
      assert_reply(reference, :ok, {:binary, second})
      assert {:ok, :pong, %{epoch: 2}} = Protocol.decode(second)
    end
  end

  describe "ownership" do
    test "grants an uncontested object to the asker, and tells everyone" do
      room = unique_room()

      {alice, alice_reply} = join_room("alice", room)
      {_bob, _bob_reply} = join_room("bob", room)
      drain_frames()

      push(alice, "frame", {:binary, Protocol.encode_ownership_request(4242, 1)})

      grants = drain_frames() |> of_kind(:ownership_grant)

      assert Enum.any?(grants, fn grant ->
               grant.network_id == 4242 and grant.owner_id == alice_reply.network_id and
                 grant.granted and grant.request_id == 1
             end)

      # The verdict goes to the whole room, sender included: the requester is
      # the peer that most needs the answer, and everyone else needs to stop
      # publishing the object's transform.
      assert length(grants) >= 2
    end

    test "refuses to take an object another peer already holds" do
      room = unique_room()

      {alice, alice_reply} = join_room("alice", room)
      {bob, _bob_reply} = join_room("bob", room)

      push(alice, "frame", {:binary, Protocol.encode_ownership_request(4242, 1)})
      drain_frames()

      push(bob, "frame", {:binary, Protocol.encode_ownership_request(4242, 7)})

      denials = drain_frames() |> of_kind(:ownership_grant) |> Enum.filter(&(&1.request_id == 7))

      assert denials != []

      Enum.each(denials, fn denial ->
        refute denial.granted
        # The denial names the winner, so the loser can show who took it.
        assert denial.owner_id == alice_reply.network_id
      end)
    end
  end

  describe "signalling" do
    test "reaches only the addressed peer" do
      # The regression that matters most here. `peer_topic/1` once returned a
      # constant, which turned every directed signal into a room-wide broadcast:
      # both the fan-out and the privacy leak that routing exists to prevent.
      # With two peers sharing one transport, a leak shows up as two deliveries
      # of one frame instead of one.
      room = unique_room()

      {alice, _alice_reply} = join_room("alice", room)
      {_bob, bob_reply} = join_room("bob", room)
      drain_frames()

      offer = "v=0 fake sdp offer"
      push(alice, "frame", {:binary, Protocol.encode_signal(bob_reply.network_id, offer)})

      signals = drain_frames() |> of_kind(:signal)

      assert [signal] = signals
      assert signal.payload == offer
      assert signal.target_network_id == bob_reply.network_id
    end

    test "stamps the true sender over whatever the client claimed" do
      # A peer that could forge this could answer a call in someone else's name.
      room = unique_room()

      {alice, alice_reply} = join_room("alice", room)
      {_bob, bob_reply} = join_room("bob", room)
      drain_frames()

      forged = Protocol.encode_signal(bob_reply.network_id, "hello", 999)
      push(alice, "frame", {:binary, forged})

      assert [signal] = drain_frames() |> of_kind(:signal)
      assert signal.sender_network_id == alice_reply.network_id
    end
  end

  describe "server authority" do
    test "refuses a client-asserted transform" do
      # The entire point of the mode. Rejecting rather than ignoring makes a
      # misconfigured client obvious instead of silently desynced.
      room = unique_room()
      {alice, alice_reply} = join_room("alice", room, %{"mode" => "server_authoritative"})

      frame =
        Protocol.encode_transform(
          alice_reply.network_id,
          %{x: 100.0, y: 0.0, z: 0.0},
          %{x: 0.0, y: 0.0, z: 0.0, w: 1.0}
        )

      reference = push(alice, "frame", {:binary, frame})

      assert_reply(reference, :error, %{reason: "client_authority_denied"})
    end
  end

  describe "server-authoritative component publication (TS-D3)" do
    # Fixed network id used by the TS-D3 Gherkin scenarios as a test fixture —
    # not one of the demo's real villager ids.
    @villager_network_id 200_001
    @character_genome_component_id 4

    defp villager_genome(genes) do
      %IwsdkPhoenix.Cardinal.CharacterGenome{genes: genes}
      |> IwsdkPhoenix.Cardinal.CharacterGenome.encode()
    end

    test "the genome travels to peers already present, byte for byte" do
      # Scénario: Le génome voyage vers un pair déjà présent
      room_id = unique_room()
      {a, _a_reply} = join_room("A", room_id)
      {_b, _b_reply} = join_room("B", room_id)
      drain_frames()

      payload = villager_genome(Enum.to_list(1..13))

      assert :ok =
               IwsdkPhoenix.Room.Server.publish_component(
                 a.assigns.room,
                 @villager_network_id,
                 @character_genome_component_id,
                 payload
               )

      records =
        drain_frames()
        |> of_kind(:component_update)
        |> Enum.flat_map(& &1.records)
        |> Enum.filter(&(&1.network_id == @villager_network_id))

      # Both A and B received it — one record delivered per peer topic.
      assert length(records) == 2
      assert Enum.all?(records, &(&1.payload == payload))
    end

    test "a latecomer receives the current genome through the cache replay" do
      # Scénario: Un retardataire reçoit l'état courant
      room_id = unique_room()
      {a, _a_reply} = join_room("A", room_id)
      {_b, _b_reply} = join_room("B", room_id)

      payload = villager_genome(Enum.to_list(13..1//-1))

      assert :ok =
               IwsdkPhoenix.Room.Server.publish_component(
                 a.assigns.room,
                 @villager_network_id,
                 @character_genome_component_id,
                 payload
               )

      # What A and B actually decoded, before C ever joins.
      present_payload =
        drain_frames()
        |> of_kind(:component_update)
        |> Enum.flat_map(& &1.records)
        |> Enum.find(&(&1.network_id == @villager_network_id))
        |> Map.fetch!(:payload)

      {_c, _c_reply} = join_room("C", room_id)

      c_payload =
        drain_frames()
        |> of_kind(:component_update)
        |> Enum.flat_map(& &1.records)
        |> Enum.find(&(&1.network_id == @villager_network_id))
        |> Map.fetch!(:payload)

      assert c_payload == present_payload
      assert c_payload == payload
    end
  end

  describe "persistent sectors" do
    test "a room is ephemeral unless the join asks otherwise" do
      # Today's behaviour, and the default: a demo lobby should not accumulate
      # world state nobody asked for.
      {socket, _reply} = join_room("alice", unique_room())

      room = socket.assigns.room
      ref = Process.monitor(room)
      # The test process is linked to the channel, which shuts down on leave.
      Process.unlink(socket.channel_pid)
      leave(socket)

      assert_receive {:DOWN, ^ref, :process, _pid, _reason}, 2000
    end

    test "a persistent room survives its last peer" do
      {socket, _reply} = join_room("alice", unique_room(), %{"persistent" => true})

      room = socket.assigns.room
      ref = Process.monitor(room)
      Process.unlink(socket.channel_pid)
      leave(socket)

      refute_receive {:DOWN, ^ref, :process, _pid, _reason}, 500
      assert Process.alive?(room)
    end
  end
end
