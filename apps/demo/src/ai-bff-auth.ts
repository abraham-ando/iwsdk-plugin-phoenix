/**
 * TS-A2 — Fournit à `installCardinalAI` un jeton de session émis par le BFF
 * (`POST /api/auth/session`) au lieu d'une clé fournisseur en dur. La clé
 * réelle (Groq/OpenAI/etc.) reste dans l'environnement du serveur BFF ; ce
 * module n'envoie jamais rien d'autre qu'un identifiant d'appareil.
 *
 * Même convention de résolution d'URL que `Mode2Client`/`TrajectoryUploader`
 * (packages/ai/../simulation) : `VITE_BFF_URL`, sinon le BFF local par défaut.
 */

export interface BffSessionTokenResult {
  token: string;
  expiresInSeconds?: number;
}

export interface BffTokenProviderOptions {
  /** Origine du BFF (ex. 'https://bff.example'). Défaut : `resolveBffBaseUrl()`. */
  baseUrl?: string;
  /** Identifiant d'appareil transmis au BFF pour émettre la session. */
  deviceId?: string;
}

export function resolveBffBaseUrl(): string {
  return (
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_BFF_URL ??
    'http://localhost:3001'
  );
}

/**
 * Un identifiant d'appareil distinct par instance de provider (donc par
 * démarrage de la démo), jamais une constante partagée : le BFF reprend ce
 * `deviceId` tel quel comme `sub` du JWT et limite le débit *par* `sub`
 * (apps/bff-server/src/rate-limiter.ts) — une constante mettrait tous les
 * joueurs derrière le même compartiment de rate-limit côté serveur.
 */
function generateDeviceId(): string {
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoRef?.randomUUID) {
    return `cardinal-village-${cryptoRef.randomUUID()}`;
  }
  // Fallback for environments without crypto.randomUUID.
  return `cardinal-village-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Construit le `tokenProvider` attendu par `CloudProviderConfig` : appelé par
 * `TokenManager` à la première requête puis à chaque expiration, jamais par
 * la démo elle-même — c'est TokenManager qui décide quand rafraîchir. Le
 * `deviceId` est résolu une fois ici et réutilisé pour chaque rafraîchissement
 * de session : stable pour un même onglet/instance, distinct entre elles.
 */
export function createBffTokenProvider(
  options: BffTokenProviderOptions = {}
): () => Promise<BffSessionTokenResult> {
  const baseUrl = (options.baseUrl ?? resolveBffBaseUrl()).replace(/\/$/, '');
  const deviceId = options.deviceId ?? generateDeviceId();

  return async (): Promise<BffSessionTokenResult> => {
    const res = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId }),
    });

    if (!res.ok) {
      throw new Error(`[ai-bff-auth] session request failed with status ${res.status}`);
    }

    const data = (await res.json()) as BffSessionTokenResult;
    return { token: data.token, expiresInSeconds: data.expiresInSeconds };
  };
}
