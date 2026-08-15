import type { CacheStorageType } from '../types/options';

export interface StorageEstimateResult {
  usageBytes: number;
  quotaBytes: number;
  usageMb: number;
  quotaMb: number;
}

export class ModelCacheManager {
  private static readonly CACHE_NAME = 'cardinal-ai-models-v1';
  private static readonly OPFS_DIR = 'cardinal_models';

  /**
   * Check if a model's weights are already stored locally in cache or OPFS.
   */
  public static async isModelCached(
    modelId: string,
    cacheType: CacheStorageType = 'opfs'
  ): Promise<boolean> {
    if (cacheType === 'none') return false;

    // 1. Check OPFS (Origin Private File System)
    if (cacheType === 'opfs' && typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
      try {
        const root = await navigator.storage.getDirectory();
        const modelsDir = await root.getDirectoryHandle(this.OPFS_DIR, { create: false });
        await modelsDir.getDirectoryHandle(modelId, { create: false });
        return true;
      } catch {
        // Not found in OPFS, fallback check in Cache API
      }
    }

    // 2. Check Cache API
    if (typeof caches !== 'undefined') {
      try {
        const cache = await caches.open(this.CACHE_NAME);
        const keys = await cache.keys();
        return keys.some((req) => req.url.includes(modelId));
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Save a model weight binary shard into OPFS storage for persistent offline use.
   */
  public static async saveToOPFS(
    modelId: string,
    filename: string,
    data: ArrayBuffer
  ): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
      return;
    }

    const root = await navigator.storage.getDirectory();
    const modelsDir = await root.getDirectoryHandle(this.OPFS_DIR, { create: true });
    const modelDir = await modelsDir.getDirectoryHandle(modelId, { create: true });
    const fileHandle = await modelDir.getFileHandle(filename, { create: true });
    const writable = await (fileHandle as any).createWritable();
    await writable.write(data);
    await writable.close();
  }

  /**
   * Read a model weight binary shard from OPFS storage.
   */
  public static async loadFromOPFS(
    modelId: string,
    filename: string
  ): Promise<ArrayBuffer | null> {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
      return null;
    }

    try {
      const root = await navigator.storage.getDirectory();
      const modelsDir = await root.getDirectoryHandle(this.OPFS_DIR, { create: false });
      const modelDir = await modelsDir.getDirectoryHandle(modelId, { create: false });
      const fileHandle = await modelDir.getFileHandle(filename, { create: false });
      const file = await fileHandle.getFile();
      return await file.arrayBuffer();
    } catch {
      return null;
    }
  }

  /**
   * Query the browser / Meta Quest storage quota and used disk space.
   */
  public static async getStorageQuota(): Promise<StorageEstimateResult> {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      const usageBytes = est.usage ?? 0;
      const quotaBytes = est.quota ?? 0;
      return {
        usageBytes,
        quotaBytes,
        usageMb: Math.round(usageBytes / (1024 * 1024)),
        quotaMb: Math.round(quotaBytes / (1024 * 1024)),
      };
    }

    return {
      usageBytes: 0,
      quotaBytes: 0,
      usageMb: 0,
      quotaMb: 0,
    };
  }

  /**
   * Delete a cached model or clear all cached models.
   */
  public static async clearCache(modelId?: string): Promise<boolean> {
    let cleared = false;

    // 1. Clear from OPFS
    if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
      try {
        const root = await navigator.storage.getDirectory();
        if (modelId) {
          const modelsDir = await root.getDirectoryHandle(this.OPFS_DIR, { create: false });
          await modelsDir.removeEntry(modelId, { recursive: true });
          cleared = true;
        } else {
          await root.removeEntry(this.OPFS_DIR, { recursive: true });
          cleared = true;
        }
      } catch {
        // Handled silently
      }
    }

    // 2. Clear from Cache API
    if (typeof caches !== 'undefined') {
      try {
        if (modelId) {
          const cache = await caches.open(this.CACHE_NAME);
          const keys = await cache.keys();
          for (const req of keys) {
            if (req.url.includes(modelId)) {
              await cache.delete(req);
              cleared = true;
            }
          }
        } else {
          cleared = await caches.delete(this.CACHE_NAME) || cleared;
        }
      } catch {
        // Handled silently
      }
    }

    return cleared;
  }
}
