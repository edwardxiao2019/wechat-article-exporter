import type { D1CacheWriteOptions } from '~/shared/utils/d1-cache';
import { writeEntryToD1 } from './d1';
import { db } from './db';

export interface CommentAsset {
  fakeid: string;
  url: string;
  title: string;
  data: any;
}

/**
 * 更新 comment 缓存
 * @param comment 缓存
 */
export async function updateCommentCache(comment: CommentAsset, options?: D1CacheWriteOptions): Promise<boolean> {
  const result = await db.transaction('rw', 'comment', async () => {
    await db.comment.put(comment);
    return true;
  });

  await writeEntryToD1(
    {
      table: 'comment',
      key: comment.url,
      record: comment as unknown as Record<string, unknown>,
    },
    options
  );

  return result;
}

/**
 * 获取 comment 缓存
 * @param url
 */
export async function getCommentCache(url: string): Promise<CommentAsset | undefined> {
  return db.comment.get(url);
}
