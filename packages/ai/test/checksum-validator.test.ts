import { describe, it, expect } from 'vitest';
import { ChecksumValidator } from '../src/security/ChecksumValidator';

describe('ChecksumValidator', () => {
  it('should compute deterministic SHA-256 hash for buffer', async () => {
    const encoder = new TextEncoder();
    const data = encoder.encode('Cardinal AI Model Weights Shard');
    const hash = await ChecksumValidator.computeSHA256(data);

    expect(typeof hash).toBe('string');
    expect(hash.length).toBe(64);
  });

  it('should verify matching checksum successfully', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const computed = await ChecksumValidator.computeSHA256(data);

    const isValid = await ChecksumValidator.verifySHA256(data, computed);
    expect(isValid).toBe(true);
  });

  it('should reject invalid / tampered checksum', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const isValid = await ChecksumValidator.verifySHA256(data, 'deadbeef1234567890abcdef');
    expect(isValid).toBe(false);
  });

  it('should pass if expected checksum is empty', async () => {
    const data = new Uint8Array([1, 2, 3]);
    const isValid = await ChecksumValidator.verifySHA256(data, '');
    expect(isValid).toBe(true);
  });
});
