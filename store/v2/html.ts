import type { D1CacheWriteOptions } from '~/shared/utils/d1-cache';
import { writeEntryToD1 } from './d1';
import { db } from './db';
import { readWithD1Fallback } from './read';

export interface HtmlAsset {
  fakeid: string;
  url: string;
  file: Blob;
  title: string;
  commentID: string | null;
}

/**
 * 更新 html 缓存
 * @param html 缓存
 */
export async function updateHtmlCache(html: HtmlAsset, options?: D1CacheWriteOptions): Promise<boolean> {
  const result = await db.transaction('rw', 'html', async () => {
    await db.html.put(html);
    return true;
  });

  await writeEntryToD1(
    {
      table: 'html',
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
export function getHtmlCache(url: string): Promise<HtmlAsset | undefined> {
  return readWithD1Fallback(
    'html',
    url,
    () => db.html.get(url),
    v => db.html.put(v)
  );
}
