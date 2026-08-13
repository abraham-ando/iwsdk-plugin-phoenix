/**
 * Where this demo connects, and how.
 *
 * Read from Vite env vars so the same build runs three ways without a code
 * change — see `.env.example`:
 *
 *   (nothing set)                        single player, no server needed
 *   VITE_PHOENIX_ENDPOINT=ws://…/socket  a real Elixir room
 *   VITE_PHOENIX_MODE=server_authoritative  …with prediction and reconciliation
 *
 * The default is deliberately the one that works with nothing running: `npm run
 * dev` in a fresh clone should show a scene, not a connection error.
 */

/** Authority models the server understands. */
export type AuthorityMode = 'host_relayed' | 'server_authoritative';

export interface DemoNetworkConfig {
  /** Phoenix socket URL, or `undefined` to run single player. */
  endpoint: string | undefined;
  /** Room to join; the Phoenix topic is `room:<roomId>`. */
  roomId: string;
  mode: AuthorityMode;
  /** True when no endpoint was configured. */
  isOffline: boolean;
  /** Metres/second used by client prediction. Must match the server. */
  moveSpeed: number;
}

/** The subset of `import.meta.env` this module reads. */
export interface NetworkEnv {
  VITE_PHOENIX_ENDPOINT?: string;
  VITE_PHOENIX_ROOM?: string;
  VITE_PHOENIX_MODE?: string;
  VITE_PHOENIX_MOVE_SPEED?: string;
}

/** Metres/second. Matches `IwsdkPhoenix.Physics.Kinematic`'s default. */
const DEFAULT_MOVE_SPEED = 4.5;

export function readNetworkConfig(env: NetworkEnv): DemoNetworkConfig {
  const endpoint = trimmed(env.VITE_PHOENIX_ENDPOINT);
  const mode: AuthorityMode =
    trimmed(env.VITE_PHOENIX_MODE) === 'server_authoritative'
      ? 'server_authoritative'
      : 'host_relayed';

  const moveSpeed = Number(env.VITE_PHOENIX_MOVE_SPEED);

  return {
    endpoint,
    roomId: trimmed(env.VITE_PHOENIX_ROOM) ?? 'lobby',
    mode,
    isOffline: endpoint === undefined,
    // A bad value here is worse than no value: prediction and the server would
    // integrate motion at different speeds, and the player would be corrected
    // on every single frame they moved.
    moveSpeed: Number.isFinite(moveSpeed) && moveSpeed > 0 ? moveSpeed : DEFAULT_MOVE_SPEED,
  };
}

/** Human-readable summary, shown in the on-screen HUD. */
export function describeConfig(config: DemoNetworkConfig): string {
  if (config.isOffline) return 'single player (no VITE_PHOENIX_ENDPOINT set)';
  return `${config.endpoint} · room:${config.roomId} · ${config.mode}`;
}

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result ? result : undefined;
}
