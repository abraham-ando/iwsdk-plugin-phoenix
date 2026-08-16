import crypto from 'node:crypto';

export interface SessionPayload {
  sub: string;
  role?: string;
  exp: number;
  iat: number;
}

export class JWTService {
  private secret: string;

  constructor(secret?: string) {
    this.secret = secret || process.env.CARDINAL_JWT_SECRET || 'cardinal_super_secret_session_key_2026';
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
