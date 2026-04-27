export const D1_CACHE_TABLES = [
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
] as const;

export type D1CacheTable = (typeof D1_CACHE_TABLES)[number];

export interface D1CacheWriteOptions {
  writeToD1?: boolean;
}

export interface D1CacheWriteRequestEntry {
  table: D1CacheTable;
  key: string;
  payload: Record<string, unknown>;
  blobField?: string | null;
  blobType?: string | null;
  blobBase64?: string | null;
}

export interface D1CacheDeleteRequestEntry {
  table: D1CacheTable;
  key: string;
}
