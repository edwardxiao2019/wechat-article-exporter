import type { D1CacheDeleteRequestEntry, D1CacheWriteOptions } from '~/shared/utils/d1-cache';
import { deleteEntriesFromD1, resolveD1Toggle } from './d1';
import { db } from './db';

// 删除公众号数据
export async function deleteAccountData(ids: string[], options?: D1CacheWriteOptions): Promise<void> {
  // phase A: enumerate D1 mirror keys before touching Dexie (read-only, outside transaction)
  const toDelete: D1CacheDeleteRequestEntry[] = [];
  if (resolveD1Toggle(options)) {
    const [articles, comments, replies, assets, debugs, htmls, metadata, resources, resourceMaps] = await Promise.all([
      db.article.where('fakeid').anyOf(ids).primaryKeys(),
      db.comment.where('fakeid').anyOf(ids).primaryKeys(),
      db.comment_reply.where('fakeid').anyOf(ids).primaryKeys(),
      db.asset.where('fakeid').anyOf(ids).primaryKeys(),
      db.debug.where('fakeid').anyOf(ids).primaryKeys(),
      db.html.where('fakeid').anyOf(ids).primaryKeys(),
      db.metadata.where('fakeid').anyOf(ids).primaryKeys(),
      db.resource.where('fakeid').anyOf(ids).primaryKeys(),
      db['resource-map'].where('fakeid').anyOf(ids).primaryKeys(),
    ]);

    for (const fakeid of ids) toDelete.push({ table: 'info', key: fakeid });
    for (const k of articles) toDelete.push({ table: 'article', key: String(k) });
    for (const k of comments) toDelete.push({ table: 'comment', key: String(k) });
    for (const k of replies) toDelete.push({ table: 'comment_reply', key: String(k) });
    for (const k of assets) toDelete.push({ table: 'asset', key: String(k) });
    for (const k of debugs) toDelete.push({ table: 'debug', key: String(k) });
    for (const k of htmls) toDelete.push({ table: 'html', key: String(k) });
    for (const k of metadata) toDelete.push({ table: 'metadata', key: String(k) });
    for (const k of resources) toDelete.push({ table: 'resource', key: String(k) });
    for (const k of resourceMaps) toDelete.push({ table: 'resource-map', key: String(k) });
  }

  // phase B: mirror deletes to D1 (failure is non-blocking — local is the source of truth)
  await deleteEntriesFromD1(toDelete, options);

  // phase C: delete from Dexie
  return db.transaction(
    'rw',
    [
      'api',
      'article',
      'asset',
      'comment',
      'comment_reply',
      'debug',
      'html',
      'info',
      'metadata',
      'resource',
      'resource-map',
    ],
    async () => {
      // todo: 调后台接口保存最近90天的接口调用情况
      // const apis = await db.api.toArray();
      // console.log('apis', apis);

      db.api.toCollection().delete();
      db.article.where('fakeid').anyOf(ids).delete();
      db.asset.where('fakeid').anyOf(ids).delete();
      db.comment.where('fakeid').anyOf(ids).delete();
      db.comment_reply.where('fakeid').anyOf(ids).delete();
      db.debug.where('fakeid').anyOf(ids).delete();
      db.html.where('fakeid').anyOf(ids).delete();
      db.info.where('fakeid').anyOf(ids).delete();
      db.metadata.where('fakeid').anyOf(ids).delete();
      db.resource.where('fakeid').anyOf(ids).delete();
      db['resource-map'].where('fakeid').anyOf(ids).delete();
    }
  );
}
