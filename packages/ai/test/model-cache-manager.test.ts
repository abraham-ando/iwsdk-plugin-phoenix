import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ModelCacheManager } from '../src/cache/ModelCacheManager';

describe('ModelCacheManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return false if cacheType is none', async () => {
    const isCached = await ModelCacheManager.isModelCached('llama-3.2-1b-it-q4f16-MLC', 'none');
    expect(isCached).toBe(false);
  });

  it('should check Cache API correctly when available', async () => {
    const mockCache = {
      keys: vi.fn().mockResolvedValue([
        new Request('https://cdn.example.com/models/llama-3.2-1b-it-q4f16-MLC/weights.bin'),
      ]),
    };

    vi.stubGlobal('caches', {
      open: vi.fn().mockResolvedValue(mockCache),
      delete: vi.fn().mockResolvedValue(true),
    });

    const isCached = await ModelCacheManager.isModelCached('llama-3.2-1b-it-q4f16-MLC', 'cache-storage');
    expect(isCached).toBe(true);

    const isOtherCached = await ModelCacheManager.isModelCached('phi-3.5-mini', 'cache-storage');
    expect(isOtherCached).toBe(false);
  });

  it('should estimate storage quota accurately', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        estimate: vi.fn().mockResolvedValue({
          usage: 104857600, // 100 MB
          quota: 1073741824, // 1 GB
        }),
      },
    });

    const quota = await ModelCacheManager.getStorageQuota();
    expect(quota.usageMb).toBe(100);
    expect(quota.quotaMb).toBe(1024);
  });
});
