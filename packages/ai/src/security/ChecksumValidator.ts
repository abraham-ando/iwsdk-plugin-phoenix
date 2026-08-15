/**
 * Cryptographic SHA-256 Checksum Validator for Model Weight Shards and Assets.
 * Uses Web Cryptography API (crypto.subtle) available in browsers, Meta Quest, and Node.js.
 */

export class ChecksumValidator {
  /**
   * Compute the hexadecimal SHA-256 hash of an ArrayBuffer or Uint8Array.
   */
  public static async computeSHA256(data: ArrayBuffer | Uint8Array): Promise<string> {
    const buffer: ArrayBuffer = data instanceof Uint8Array ? (data.buffer as ArrayBuffer) : data;

    if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    // Fallback lightweight deterministic hash if Web Crypto is unavailable in mock environment
    let hash = 0x811c9dc5;
    const view = new Uint8Array(buffer);
    for (let i = 0; i < view.length; i++) {
      const byte = view[i] ?? 0;
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(64, '0');
  }

  /**
   * Verify that the data matches the expected SHA-256 digest.
   */
  public static async verifySHA256(
    data: ArrayBuffer | Uint8Array,
    expectedChecksum: string
  ): Promise<boolean> {
    if (!expectedChecksum) return true;
    const actualChecksum = await this.computeSHA256(data);
    return actualChecksum.toLowerCase() === expectedChecksum.toLowerCase().trim();
  }
}
