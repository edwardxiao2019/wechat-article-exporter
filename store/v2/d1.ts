import type {
  D1CacheDeleteRequestEntry,
  D1CacheTable,
  D1CacheWriteOptions,
  D1CacheWriteRequestEntry,
} from '~/shared/utils/d1-cache';

interface D1CacheEntry {
  table: D1CacheTable;
  key: string;
  record: Record<string, unknown>;
}

// --- helpers ---

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// --- preference toggle ---

// Reads d1MirrorEnabled from localStorage directly (not via usePreferences ref)
// so this module works outside Vue lifecycle contexts.
// explicit options.writeToD1 takes precedence; undefined falls back to preference.
export function resolveD1Toggle(options?: D1CacheWriteOptions): boolean {
  if (typeof options?.writeToD1 === 'boolean') return options.writeToD1;
  if (!import.meta.client) return false;
  try {
    const raw = localStorage.getItem('preferences');
    if (!raw) return false;
    return JSON.parse(raw)?.d1MirrorEnabled === true;
  } catch {
    return false;
  }
}

// --- negative cache (avoids hammering D1 on repeated misses) ---

const negativeCacheMap = new Map<string, number>(); // key -> expiry ms
const NEGATIVE_CACHE_TTL = 5 * 60 * 1000;
const NEGATIVE_CACHE_MAX = 1000;

function isNegativeCached(key: string): boolean {
  const expiry = negativeCacheMap.get(key);
  if (expiry === undefined) return false;
  if (Date.now() > expiry) {
    negativeCacheMap.delete(key);
    return false;
  }
  return true;
}

function setNegativeCached(key: string): void {
  if (negativeCacheMap.size >= NEGATIVE_CACHE_MAX) {
    negativeCacheMap.delete(negativeCacheMap.keys().next().value!);
  }
  negativeCacheMap.set(key, Date.now() + NEGATIVE_CACHE_TTL);
}

// --- write ---

async function serializeEntry(entry: D1CacheEntry): Promise<D1CacheWriteRequestEntry> {
  const payload: Record<string, unknown> = {};
  let blobField: string | null = null;
  let blobType: string | null = null;
  let blobBase64: string | null = null;

  for (const [key, value] of Object.entries(entry.record)) {
    if (value instanceof Blob) {
      if (blobField) {
        throw new Error(`D1 mirror only supports one Blob field per record: ${entry.table}/${entry.key}`);
      }

      blobField = key;
      blobType = value.type || null;
      blobBase64 = arrayBufferToBase64(await value.arrayBuffer());
      payload[key] = null;
      continue;
    }

    payload[key] = value;
  }

  return {
    table: entry.table,
    key: entry.key,
    payload,
    blobField,
    blobType,
    blobBase64,
  };
}

export async function writeEntriesToD1(entries: D1CacheEntry[], options?: D1CacheWriteOptions): Promise<void> {
  if (!resolveD1Toggle(options) || !import.meta.client || entries.length === 0) {
    return;
  }

  try {
    const body = {
      entries: await Promise.all(entries.map(serializeEntry)),
    };

    await $fetch('/api/web/cache/d1', {
      method: 'POST',
      body,
    });
  } catch (error) {
    console.warn('[store/v2] failed to mirror cache writes to D1', error);
  }
}

export async function writeEntryToD1(entry: D1CacheEntry, options?: D1CacheWriteOptions): Promise<void> {
  await writeEntriesToD1([entry], options);
}

// --- delete ---

export async function deleteEntriesFromD1(
  entries: D1CacheDeleteRequestEntry[],
  options?: D1CacheWriteOptions
): Promise<void> {
  if (!resolveD1Toggle(options) || !import.meta.client || entries.length === 0) return;
  try {
    await $fetch('/api/web/cache/d1', { method: 'POST', body: { action: 'delete', entries } });
  } catch (error) {
    console.warn('[store/v2] failed to mirror cache deletes to D1', error);
  }
}

// --- read (D1 fallback) ---

export async function fetchEntryFromD1<T>(table: D1CacheTable, key: string): Promise<T | undefined> {
  if (!resolveD1Toggle(undefined)) return undefined;
  if (!import.meta.client) return undefined;

  const cacheKey = `${table}:${key}`;
  if (isNegativeCached(cacheKey)) return undefined;

  try {
    const resp = await $fetch<{
      ok: boolean;
      found: boolean;
      payload?: Record<string, unknown>;
      blobField?: string | null;
      blobType?: string | null;
      blobBase64?: string | null;
    }>('/api/web/cache/d1', { method: 'POST', body: { action: 'read', table, key } });

    if (!resp.found) {
      setNegativeCached(cacheKey);
      return undefined;
    }

    const record = { ...resp.payload };
    if (resp.blobField && resp.blobBase64) {
      record[resp.blobField] = new Blob([base64ToArrayBuffer(resp.blobBase64)], { type: resp.blobType ?? '' });
    }

    return record as T;
  } catch (error) {
    console.warn('[store/v2] D1 fallback read failed', error);
    return undefined;
  }
}
