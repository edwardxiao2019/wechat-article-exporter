import type { D1CacheTable } from '~/shared/utils/d1-cache';
import { fetchEntryFromD1 } from './d1';

// Local-first read with D1 fallback.
// If IndexedDB has the record, return it immediately.
// On miss, try D1 (respects the d1MirrorEnabled preference).
// On D1 hit, write back to local so subsequent reads are cache-warm.
export async function readWithD1Fallback<T>(
  table: D1CacheTable,
  key: string,
  localGetter: () => Promise<T | undefined>,
  localFiller: (value: T) => Promise<unknown>
): Promise<T | undefined> {
  const local = await localGetter();
  if (local !== undefined) return local;

  const remote = await fetchEntryFromD1<T>(table, key);
  if (remote !== undefined) {
    // fire-and-forget: warm the local cache; failures are silent
    localFiller(remote).catch(() => {});
  }

  return remote;
}
