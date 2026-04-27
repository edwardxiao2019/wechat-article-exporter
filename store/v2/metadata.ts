import type { D1CacheWriteOptions } from '~/shared/utils/d1-cache';
import type { ArticleMetadata } from '~/utils/download/types';
import { writeEntryToD1 } from './d1';
import { db } from './db';
import { readWithD1Fallback } from './read';

export type Metadata = ArticleMetadata & {
  fakeid: string;
  url: string;
  title: string;
};

/**
 * 更新 metadata
 * @param metadata
 */
export async function updateMetadataCache(metadata: Metadata, options?: D1CacheWriteOptions): Promise<boolean> {
  const result = await db.transaction('rw', 'metadata', async () => {
    await db.metadata.put(metadata);
    return true;
  });

  await writeEntryToD1(
    {
      table: 'metadata',
      key: metadata.url,
      record: metadata as unknown as Record<string, unknown>,
    },
    options
  );

  return result;
}

/**
 * 获取 metadata
 * @param url
 */
export function getMetadataCache(url: string): Promise<Metadata | undefined> {
  return readWithD1Fallback(
    'metadata',
    url,
    () => db.metadata.get(url),
    v => db.metadata.put(v)
  );
}
