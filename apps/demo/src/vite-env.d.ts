/// <reference types="vite/client" />
/// <reference types="@iwsdk/vite-plugin-dev/client" />

/**
 * Demo configuration. See `.env.example`; all optional, and with none of them
 * set the demo runs single player.
 */
interface ImportMetaEnv {
  /** Phoenix socket URL, e.g. `ws://localhost:4000/socket`. */
  readonly VITE_PHOENIX_ENDPOINT?: string;
  /** Room to join. Phoenix topic is `room:<value>`. Defaults to `lobby`. */
  readonly VITE_PHOENIX_ROOM?: string;
  /** `host_relayed` (default) or `server_authoritative`. */
  readonly VITE_PHOENIX_MODE?: string;
  /** Metres/second for client prediction. Must match the server. */
  readonly VITE_PHOENIX_MOVE_SPEED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
