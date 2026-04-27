import type { D1CacheWriteOptions } from '~/shared/utils/d1-cache';
import { writeEntryToD1 } from './d1';
import { db } from './db';

export interface DebugAsset {
  type: string;
  url: string;
  file: Blob;
  title: string;
  fakeid: string;
}

/**
 * 更新 html 缓存
 * @param html 缓存
 */
export async function updateDebugCache(html: DebugAsset, options?: D1CacheWriteOptions): Promise<boolean> {
  const result = await db.transaction('rw', 'debug', async () => {
    await db.debug.put(html);
    return true;
  });

  await writeEntryToD1(
    {
      table: 'debug',
      key: html.url,
      record: html as unknown as Record<string, unknown>,
    },
    options
  );

  return result;
}

/**
 * 获取 asset 缓存
 * @param url
 */
export async function getDebugCache(url: string): Promise<DebugAsset | undefined> {
  return db.debug.get(url);
}

export async function getDebugInfo(): Promise<DebugAsset[]> {
  return db.debug.toArray();
}
