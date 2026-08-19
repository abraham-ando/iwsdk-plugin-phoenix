import crypto from 'node:crypto';

export interface SessionPayload {
  sub: string;
  role?: string;
  exp: number;
  iat: number;
}

const DEFAULT_DEV_SECRET = 'cardinal_super_secret_session_key_2026';

/** The default secret is only acceptable when we're not running in
 * production, or when an operator has explicitly opted in via
 * ALLOW_DEFAULT_JWT_SECRET (e.g. `--dev` at the index.ts entrypoint). */
function defaultSecretAllowed(): boolean {
  const override = process.env.ALLOW_DEFAULT_JWT_SECRET;
  if (override === 'true' || override === '1') return true;
  return process.env.NODE_ENV !== 'production';
}

export class JWTService {
  private secret: string;

  constructor(secret?: string) {
    if (secret) {
      this.secret = secret;
      return;
    }
    const envSecret = process.env.CARDINAL_JWT_SECRET;
    if (envSecret) {
      this.secret = envSecret;
      return;
    }
    if (!defaultSecretAllowed()) {
      throw new Error(
        'CARDINAL_JWT_SECRET is not set. Refusing to start with the hardcoded default JWT ' +
          'secret outside development, because JWT verification is the only gate in front of ' +
          '/api/v1/cardinal/chat and the real provider key behind it. Set CARDINAL_JWT_SECRET, ' +
          'or set ALLOW_DEFAULT_JWT_SECRET=true to override explicitly (not recommended).'
      );
    }
    console.warn(
      '[Cardinal BFF] CARDINAL_JWT_SECRET is not set — falling back to the default development ' +
        'secret. This is INSECURE and must never be used in production.'
    );
    this.secret = DEFAULT_DEV_SECRET;
  }

  private base64UrlEncode(str: string): string {
    return Buffer.from(str)
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }

  private base64UrlDecode(str: string): string {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    return Buffer.from(base64, 'base64').toString('utf8');
  }

  public sign(subject: string, expiresInSeconds: number = 3600, role: string = 'player'): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload: SessionPayload = {
      sub: subject,
      role,
      iat: now,
      exp: now + expiresInSeconds,
    };

    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));
    const data = `${encodedHeader}.${encodedPayload}`;

    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(data)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    return `${data}.${signature}`;
  }

  public verify(token: string): { valid: boolean; payload?: SessionPayload; error?: string } {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return { valid: false, error: 'Invalid JWT format' };
      }

      const [headerB64, payloadB64, sigB64] = parts;
      const data = `${headerB64}.${payloadB64}`;

      const expectedSig = crypto
        .createHmac('sha256', this.secret)
        .update(data)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      if (sigB64 !== expectedSig) {
        return { valid: false, error: 'Invalid signature' };
      }

      const payload: SessionPayload = JSON.parse(this.base64UrlDecode(payloadB64!));
      const now = Math.floor(Date.now() / 1000);

      if (payload.exp < now) {
        return { valid: false, error: 'Session token has expired' };
      }

      return { valid: true, payload };
    } catch {
      return { valid: false, error: 'Malformed token payload' };
    }
  }
}
