import type { D1CacheWriteOptions } from '~/shared/utils/d1-cache';
import { writeEntryToD1 } from './d1';
import { db } from './db';
import { readWithD1Fallback } from './read';

interface Asset {
  url: string;
  file: Blob;
  fakeid: string;
}

export type { Asset };

/**
 * 更新 asset 缓存
 * @param asset
 */
export async function updateAssetCache(asset: Asset, options?: D1CacheWriteOptions): Promise<boolean> {
  const result = await db.transaction('rw', 'asset', () => {
    db.asset.put(asset);
    return true;
  });

  await writeEntryToD1(
    {
      table: 'asset',
      key: asset.url,
      record: asset as unknown as Record<string, unknown>,
    },
    options
  );

  return result;
}

/**
 * 获取 asset 缓存
 * @param url
 */
export function getAssetCache(url: string): Promise<Asset | undefined> {
  return readWithD1Fallback(
    'asset',
    url,
    () => db.asset.get(url),
    v => db.asset.put(v)
  );
}
