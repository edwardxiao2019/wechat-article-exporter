import type { D1CacheWriteOptions } from '~/shared/utils/d1-cache';
import type { AppMsgExWithFakeID, PublishInfo, PublishPage } from '~/types/types';
import { writeEntriesToD1 } from './d1';
import { db } from './db';
import { type MpAccount, updateInfoCache } from './info';

export type ArticleAsset = AppMsgExWithFakeID;

/**
 * 更新文章缓存
 * @param account
 * @param publish_page
 */
export async function updateArticleCache(account: MpAccount, publish_page: PublishPage, options?: D1CacheWriteOptions) {
  const mirroredArticles: ArticleAsset[] = [];

  await db.transaction('rw', ['article', 'info'], async () => {
    const keys = await db.article.toCollection().keys();

    const fakeid = account.fakeid;
    const total_count = publish_page.total_count;
    const publish_list = publish_page.publish_list.filter(item => !!item.publish_info);

    // 统计本次缓存成功新增的数量
    let msgCount = 0;
    let articleCount = 0;

    for (const item of publish_list) {
      const publish_info: PublishInfo = JSON.parse(item.publish_info);
      let newEntryCount = 0;

      for (const article of publish_info.appmsgex) {
        const cachedArticle = { ...article, fakeid, _status: '' };
        const key = await db.article.put(cachedArticle, `${fakeid}:${article.aid}`);
        mirroredArticles.push(cachedArticle);
        if (!keys.includes(key)) {
          newEntryCount++;
          articleCount++;
        }
      }

      if (newEntryCount > 0) {
        // 新增成功
        msgCount++;
      }
    }

    await updateInfoCache({
      fakeid: fakeid,
      completed: publish_list.length === 0,
      count: msgCount,
      articles: articleCount,
      nickname: account.nickname,
      round_head_img: account.round_head_img,
      total_count: total_count,
    });
  });

  await writeEntriesToD1(
    mirroredArticles.map(article => ({
      table: 'article',
      key: `${article.fakeid}:${article.aid}`,
      record: article as unknown as Record<string, unknown>,
    })),
    options
  );

  const infoCache = await db.info.get(account.fakeid);
  if (infoCache) {
    await writeEntriesToD1(
      [
        {
          table: 'info',
          key: infoCache.fakeid,
          record: infoCache as unknown as Record<string, unknown>,
        },
      ],
      options
    );
  }
}

/**
 * 检查是否存在指定时间之前的缓存
 * @param fakeid 公众号id
 * @param create_time 创建时间
 */
export async function hitCache(fakeid: string, create_time: number): Promise<boolean> {
  const count = await db.article
    .where('fakeid')
    .equals(fakeid)
    .and(article => article.create_time < create_time)
    .count();
  return count > 0;
}

/**
 * 读取缓存中的指定时间之前的历史文章
 * @param fakeid 公众号id
 * @param create_time 创建时间
 */
export async function getArticleCache(fakeid: string, create_time: number): Promise<AppMsgExWithFakeID[]> {
  return db.article
    .where('fakeid')
    .equals(fakeid)
    .and(article => article.create_time < create_time)
    .reverse()
    .sortBy('create_time');
}

/**
 * 根据 url 获取文章对象
 * @param url
 */
export async function getArticleByLink(url: string): Promise<AppMsgExWithFakeID> {
  const article = await db.article.where('link').equals(url).first();
  if (!article) {
    throw new Error(`Article(${url}) does not exist`);
  }
  return article;
}

// 根据 url 获取 SINGLE_ARTICLE_FAKEID 文章对象
export async function getSingleArticleByLink(url: string): Promise<AppMsgExWithFakeID> {
  const article = await db.article
    .where('link')
    .equals(url)
    .and(article => article.fakeid === 'SINGLE_ARTICLE_FAKEID')
    .first();
  if (!article) {
    throw new Error(`Article(${url}) does not exist`);
  }

  return article;
}

/**
 * 文章被删除
 * @param url
 * @param is_deleted
 */
export async function articleDeleted(url: string, is_deleted = true, options?: D1CacheWriteOptions): Promise<void> {
  await db.transaction('rw', 'article', async () => {
    await db.article
      .where('link')
      .equals(url)
      .modify(article => {
        article.is_deleted = is_deleted;
      });
  });

  const updatedArticles = await db.article.where('link').equals(url).toArray();
  await writeEntriesToD1(
    updatedArticles.map(article => ({
      table: 'article',
      key: `${article.fakeid}:${article.aid}`,
      record: article as unknown as Record<string, unknown>,
    })),
    options
  );
}

/**
 * 更新文章状态
 * @param url
 * @param status
 */
export async function updateArticleStatus(url: string, status: string, options?: D1CacheWriteOptions): Promise<void> {
  await db.transaction('rw', 'article', async () => {
    await db.article
      .where('link')
      .equals(url)
      .modify(article => {
        article._status = status;
      });
  });

  const updatedArticles = await db.article.where('link').equals(url).toArray();
  await writeEntriesToD1(
    updatedArticles.map(article => ({
      table: 'article',
      key: `${article.fakeid}:${article.aid}`,
      record: article as unknown as Record<string, unknown>,
    })),
    options
  );
}

/**
 * 更新文章的fakeid
 * @param url
 * @param fakeid
 */
export async function updateArticleFakeid(url: string, fakeid: string, options?: D1CacheWriteOptions): Promise<void> {
  await db.transaction('rw', 'article', async () => {
    await db.article
      .where('link')
      .equals(url)
      .and(article => article.fakeid === 'SINGLE_ARTICLE_FAKEID')
      .modify(article => {
        article.fakeid = fakeid;

        // 标记改数据是【单篇文章下载】添加的
        article._single = true;
      });
  });

  const updatedArticles = await db.article.where('link').equals(url).toArray();
  await writeEntriesToD1(
    updatedArticles.map(article => ({
      table: 'article',
      key: `${article.fakeid}:${article.aid}`,
      record: article as unknown as Record<string, unknown>,
    })),
    options
  );
}
