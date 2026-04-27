import type { D1CacheWriteOptions } from '~/shared/utils/d1-cache';
import { writeEntryToD1 } from './d1';
import { db } from './db';

export interface ResourceMapAsset {
  fakeid: string;
  url: string;
  resources: string[];
}

/**
 * 更新 resource-map 缓存
 * @param resourceMap 缓存
 */
export async function updateResourceMapCache(
  resourceMap: ResourceMapAsset,
  options?: D1CacheWriteOptions
): Promise<boolean> {
  const result = await db.transaction('rw', 'resource-map', async () => {
    await db['resource-map'].put(resourceMap);
    return true;
  });

  await writeEntryToD1(
    {
      table: 'resource-map',
      key: resourceMap.url,
      record: resourceMap as unknown as Record<string, unknown>,
    },
    options
  );

  return result;
}

/**
 * 获取 resource-map 缓存
 * @param url
 */
export async function getResourceMapCache(url: string): Promise<ResourceMapAsset | undefined> {
  return db['resource-map'].get(url);
}
