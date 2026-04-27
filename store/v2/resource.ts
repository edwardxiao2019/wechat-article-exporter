import type { D1CacheWriteOptions } from '~/shared/utils/d1-cache';
import { writeEntryToD1 } from './d1';
import { db } from './db';
import { readWithD1Fallback } from './read';

export interface ResourceAsset {
  fakeid: string;
  url: string;
  file: Blob;
}

/**
 * 更新 resource 缓存
 * @param resource 缓存
 */
export async function updateResourceCache(resource: ResourceAsset, options?: D1CacheWriteOptions): Promise<boolean> {
  const result = await db.transaction('rw', 'resource', async () => {
    await db.resource.put(resource);
    return true;
  });

  await writeEntryToD1(
    {
      table: 'resource',
      key: resource.url,
      record: resource as unknown as Record<string, unknown>,
    },
    options
  );

  return result;
}

/**
 * 获取 resource 缓存
 * @param url
 */
export function getResourceCache(url: string): Promise<ResourceAsset | undefined> {
  return readWithD1Fallback(
    'resource',
    url,
    () => db.resource.get(url),
    v => db.resource.put(v)
  );
}
