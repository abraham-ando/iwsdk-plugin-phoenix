# Persistent sectors and world environment — design

Approved 2026-08-14, brainstormed section by section. Layer 1 of the Cardinal
programme: a sector's world keeps evolving while nobody is in it, and the
day/night cycle costs nothing on the wire.

## Context

Today a room dies with its last occupant — `room/server.ex:113`, *"Reap the
room with its last occupant"* — so the world only exists while someone is
watching it. The mechanism to keep one alive already exists
(`stop_when_empty`, default `false` at `room/server.ex:95`) but the channel
hardcodes `true` at `room_channel.ex:306`, with no way to override it.

`IwsdkPhoenix.Persistence` already provides a `Buffer` and a `Writer` with
write coalescing. Nothing calls them.

## The approach, and the one rejected

**Lazy fast-forward.** A sector still stops when it empties. Its state is
timestamped, and on the next join it restarts and *advances* in one step:
`advance(state, elapsed)`.

The alternative considered was a macro-tick — keep the process alive and drop
its rate to ~0.5 Hz when empty. It was rejected on arithmetic. At the scale
this programme targets, 30M concurrent in instances of 80 is roughly 375,000
sectors; a 0.5 Hz tick over empty ones is **187,500 messages per second** of
pure overhead for worlds nobody is looking at. Fast-forward costs nothing.

Its one genuine cost is a constraint, and a healthy one: **everything that
evolves without players must be a pure function of elapsed time.** That is
testable, deterministic, and it is what makes offline progress work in every
game that has it. An event can only occur while someone is present — and if
nobody is present there is no event to reproduce.

A separate long-lived "sector" process alongside ephemeral rooms was also
considered and rejected: in this repo a room already *is* a world, with
`SpatialGrid` dividing the space inside it. A second layer would correspond to
nothing in the existing model and would add cross-process reads to the hot
path.

## Section 1 — The time model

The design rests on a distinction the code does not yet make: a sector's
**world time** is not its process time.

```elixir
world_time_ms   # the world's own clock; advances even with no process
last_seen_ms    # server time at the last stop (Clock.now_ms)
```

On stop the sector records `last_seen_ms`. On restart it computes
`elapsed = Clock.now_ms() - last_seen_ms` and applies `advance(state, elapsed)`.
A sector that slept three hours reopens three hours later in its own world, in
one call.

Decisions:

- **`Clock.now_ms` (monotonic), not the wall clock.** It is the base the clock
  synchronization block already established, and it never runs backwards. The
  price is that its origin changes when the node restarts, making `elapsed`
  meaningless — which is exactly what `Clock.epoch()` detects. A sector
  reloaded under a different epoch does **not** fast-forward: it resumes from
  its saved state with no advance. Visibly conservative rather than wrong.
- **The day/night cycle is not part of this state.** It is a pure function of
  `world_time_ms`, computed on demand by both sides:
  `sun_angle = ((t mod day_length) / day_length) × 2π`. Nothing to store,
  replicate, or catch up.
- **`advance/2` is bounded.** A sector abandoned for six months must not run
  six months of weather transitions on waking. Past a cap — one full day
  cycle — it jumps straight to the state the elapsed time implies rather than
  stepping through. A pure function of time permits that; it is the other
  reason for wanting it pure.

## Section 2 — Weather as fast-forwardable state

`IwsdkPhoenix.World.Weather`, pure Elixir, no process:

```elixir
%Weather{kind: :clear | :rain | :storm | :fog,
         intensity: 0.0..1.0,
         wind: %{x: _, y: _, z: _},
         next_transition_at_ms: _}
```

**Transitions are drawn, but the seed is the time.** Each next transition is
decided from `:rand.seed(:exsss, {sector_hash, div(world_time_ms, cycle), 0})`,
so the same sector at the same world time always produces the same sequence.
Two consequences: `advance/2` replays exactly what would have happened, and a
test can assert an entire weather trace without simulating anything.

That seeding is what makes stateful weather compatible with fast-forward, and
it was missing from the research that proposed it.

`advance(weather, elapsed_ms, sector_id)` loops while
`next_transition_at_ms` is passed, drawing each transition, bounded to one day
cycle beyond which it jumps to the final draw. A game may `force/2` a state at
any time and the next draw proceeds from there — which is what choosing
stateful weather bought, and it survives fast-forward because nothing forces
anything while a sector sleeps.

**On the wire, weather is a Cardinal component.** It needs no frame of its
own: a record inside a batch is exactly what layer 0 built, with generated
bytes and proven parity. Added to the schema:

```js
{ id: 3, name: 'Weather',
  fields: [{ name: 'kind', type: 'u8' },
           { name: 'intensity', type: 'f32' },
           { name: 'wind', type: 'vec3' }] }
```

17 bytes, carried by the cache that already replays state to newcomers. The
day/night cycle does not travel: both sides compute it.

## Section 3 — Sector lifecycle

`room_channel.ex:306` hardcodes `stop_when_empty: true`. It becomes a join
param, `persistent`, defaulting to `false` — a demo lobby stays ephemeral, a
world is persistent only when asked for.

**On stop** — the `handle_call({:leave, ...})` clause that returns
`{:stop, :normal, ...}` — a persistent sector first writes a snapshot:

```elixir
%{world_time_ms: _, last_seen_ms: Clock.now_ms(), epoch: Clock.epoch(), weather: _}
```

In memory for this block, in a **named public ETS table** keyed by sector id,
owned by a small `IwsdkPhoenix.World.Snapshots` process supervised alongside
the room `DynamicSupervisor`.

Not `:persistent_term`, though the epoch uses it and the shape would fit.
`:persistent_term.put/2` may trigger a global garbage collection of every
process holding a reference to the replaced term — it is built for
write-once, read-many, which is exactly how `Clock.epoch/0` uses it. A write
per sector close is the opposite pattern, and at the scale that justifies this
whole design it would be a serious defect. ETS is cheap in both directions and
is the idiomatic answer.

The table needs an owner because an ETS table dies with the process that
created it; the `Snapshots` process exists for that and nothing else. Its
value shape is already what a `Persistence.Writer` will take later — the same
serializable map.

**On start**, `RoomSupervisor.ensure_started` loads the snapshot if present.
Three cases, and the distinction matters:

| Case | What happens |
|---|---|
| No snapshot | New world, `world_time_ms` at 0 |
| Snapshot, **same** epoch | `elapsed = now - last_seen_ms`, then `advance/2` |
| Snapshot, **different** epoch | The node restarted: restore state, do not advance |

The third case is what Section 1 anticipated. Advancing without a shared time
base would produce an arbitrary `elapsed` — a world leaping seventeen years
because the BEAM restarted.

**What does not change**: the tick stays at 30 Hz while players are present,
and the process does not exist when they are not. No idle loop, no rate
switching. That is the whole benefit of the chosen approach.

## Section 4 — Verification

1. **Weather in pure Elixir, with exact traces.** Because the seed derives
   from time and sector id, a test can assert a whole sequence without
   simulating. The assertions that matter:
   - `advance(state, elapsed)` **equals** N successive calls covering the same
     elapsed span — the property that makes fast-forward legitimate, and
     without which nothing else holds.
   - Two different sectors at the same time diverge; the same sector at the
     same time never does.
   - The cap: `advance` over six months terminates and matches one day cycle
     from the equivalent state.
   - `force/2` takes effect and the next draw proceeds from it.
2. **The day/night cycle, on both sides.** A pure function, so golden vectors
   in the TSV: `world_time_ms → angle`. The client computes the sun, not the
   server, so they must agree — same mechanism as component parity, reusing
   the existing generator.
3. **Lifecycle, in ExUnit.** A persistent sector survives its last peer
   leaving; it reopens with the world advanced by the right delta; a different
   epoch restores **without** advancing; a non-persistent sector dies as it
   does today, which is the regression test for current behaviour. Plus one
   for the snapshot store itself: a sector that *crashes* rather than stopping
   cleanly leaves its last snapshot behind, since the table outlives it.
4. **End to end in `apps/demo_server`.** A peer joins, leaves, returns after a
   simulated pause, and receives weather consistent with the elapsed time —
   through the cache replay layer 0 already provides.

Test-time control comes from `Clock.now_ms` being called by the sector, not by
the weather module: `advance` tests pass `elapsed` directly, and lifecycle
tests manipulate the snapshot. No `:timer.sleep` anywhere.

## Out of scope

- **Persistence across a node restart.** The snapshot shape is deliberately
  the one `Persistence.Buffer`/`Writer` will take, but wiring them is a
  separate block — measure the in-memory version first.
- Cross-node sector migration. `Zone.Handoff` exists and is untouched here.
- Any NPC, patrol or resource simulation. Weather and the day/night cycle are
  the two the research validated; anything else arrives with its own spec and
  must satisfy the same purity constraint to remain fast-forwardable.
- Client-side rendering of weather. This block replicates the state; turning
  rain into particles is an application concern.
