import type { H3Event } from 'h3';
import {
  D1_CACHE_TABLES,
  type D1CacheDeleteRequestEntry,
  type D1CacheWriteRequestEntry,
} from '~/shared/utils/d1-cache';

interface D1StatementLike {
  bind(...values: unknown[]): {
    run(): Promise<unknown>;
    first<T = unknown>(): Promise<T | null>;
  };
}

interface D1DatabaseLike {
  exec(query: string): Promise<unknown>;
  prepare(query: string): D1StatementLike;
}

const initializedTables = new Set<string>();

function sanitizeIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw createError({
      statusCode: 500,
      statusMessage: `Invalid D1 identifier: ${value}`,
    });
  }

  return value;
}

function getD1Database(event: H3Event): D1DatabaseLike | null {
  const config = useRuntimeConfig();
  const bindingName = sanitizeIdentifier(config.d1Cache.binding);
  const cloudflareEnv = (event.context as { cloudflare?: { env?: Record<string, unknown> } }).cloudflare?.env;
  const db = cloudflareEnv?.[bindingName];

  if (!db) {
    return null;
  }

  return db as D1DatabaseLike;
}

async function ensureMirrorTable(db: D1DatabaseLike, tableName: string): Promise<void> {
  if (initializedTables.has(tableName)) {
    return;
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      cache_table TEXT NOT NULL,
      entry_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      blob_field TEXT,
      blob_type TEXT,
      blob_payload BLOB,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (cache_table, entry_key)
    )
  `);

  initializedTables.add(tableName);
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function normalizeWriteEntry(entry: D1CacheWriteRequestEntry): D1CacheWriteRequestEntry {
  if (!entry || typeof entry !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'entries must be objects' });
  }

  if (!entry.table || !entry.key || !entry.payload || typeof entry.payload !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'entry.table, entry.key and entry.payload are required' });
  }

  if (!D1_CACHE_TABLES.includes(entry.table)) {
    throw createError({ statusCode: 400, statusMessage: `unsupported cache table: ${entry.table}` });
  }

  return entry;
}

function normalizeDeleteEntry(entry: D1CacheDeleteRequestEntry): D1CacheDeleteRequestEntry {
  if (!entry || typeof entry !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'delete entries must be objects' });
  }
  if (!entry.table || !entry.key) {
    throw createError({ statusCode: 400, statusMessage: 'entry.table and entry.key are required' });
  }
  if (!D1_CACHE_TABLES.includes(entry.table)) {
    throw createError({ statusCode: 400, statusMessage: `unsupported cache table: ${entry.table}` });
  }
  return entry;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export default defineEventHandler(async event => {
  const config = useRuntimeConfig();

  if (!config.d1Cache.enabled) {
    throw createError({
      statusCode: 503,
      statusMessage: 'D1 cache mirror is disabled',
    });
  }

  const body = await readBody<{
    action?: string;
    entries?: unknown[];
    table?: string;
    key?: string;
  }>(event);

  const action = body?.action ?? 'upsert';

  const db = getD1Database(event);
  if (!db) {
    throw createError({
      statusCode: 503,
      statusMessage: 'D1 binding is unavailable in the current runtime',
    });
  }

  const tableName = sanitizeIdentifier(config.d1Cache.table);
  await ensureMirrorTable(db, tableName);

  // --- read ---
  if (action === 'read') {
    if (!body?.table || !body?.key) {
      throw createError({ statusCode: 400, statusMessage: 'table and key are required for read' });
    }
    if (!D1_CACHE_TABLES.includes(body.table as (typeof D1_CACHE_TABLES)[number])) {
      throw createError({ statusCode: 400, statusMessage: `unsupported cache table: ${body.table}` });
    }

    const row = await db
      .prepare(
        `SELECT payload_json, blob_field, blob_type, blob_payload FROM ${tableName} WHERE cache_table = ? AND entry_key = ? LIMIT 1`
      )
      .bind(body.table, body.key)
      .first<{
        payload_json: string;
        blob_field: string | null;
        blob_type: string | null;
        blob_payload: ArrayBuffer | null;
      }>();

    if (!row) {
      return { ok: true, found: false };
    }

    return {
      ok: true,
      found: true,
      payload: JSON.parse(row.payload_json),
      blobField: row.blob_field,
      blobType: row.blob_type,
      blobBase64: row.blob_payload ? encodeBase64(row.blob_payload) : null,
    };
  }

  // --- delete ---
  if (action === 'delete') {
    const rawEntries = Array.isArray(body?.entries) ? body.entries : [];
    if (rawEntries.length === 0) {
      return { ok: true, deleted: 0 };
    }

    const entries = rawEntries.map(e => normalizeDeleteEntry(e as D1CacheDeleteRequestEntry));

    // group by table, then chunk by 80 (D1 bind limit ~100, leave headroom)
    const byTable = new Map<string, string[]>();
    for (const entry of entries) {
      const keys = byTable.get(entry.table) ?? [];
      keys.push(entry.key);
      byTable.set(entry.table, keys);
    }

    for (const [table, keys] of byTable) {
      for (const chunk of chunkArray(keys, 80)) {
        const placeholders = chunk.map(() => '?').join(',');
        await db
          .prepare(`DELETE FROM ${tableName} WHERE cache_table = ? AND entry_key IN (${placeholders})`)
          .bind(table, ...chunk)
          .run();
      }
    }

    return { ok: true, deleted: entries.length };
  }

  // --- upsert (default) ---
  const entries = Array.isArray(body?.entries)
    ? (body.entries as D1CacheWriteRequestEntry[]).map(normalizeWriteEntry)
    : [];

  if (entries.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'entries is required' });
  }

  const statement = db.prepare(`
    INSERT INTO ${tableName} (
      cache_table,
      entry_key,
      payload_json,
      blob_field,
      blob_type,
      blob_payload,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cache_table, entry_key) DO UPDATE SET
      payload_json = excluded.payload_json,
      blob_field = excluded.blob_field,
      blob_type = excluded.blob_type,
      blob_payload = excluded.blob_payload,
      updated_at = excluded.updated_at
  `);

  const updatedAt = Math.floor(Date.now() / 1000);

  for (const entry of entries) {
    const blobPayload = entry.blobBase64 ? decodeBase64(entry.blobBase64) : null;

    await statement
      .bind(
        entry.table,
        entry.key,
        JSON.stringify(entry.payload),
        entry.blobField || null,
        entry.blobType || null,
        blobPayload,
        updatedAt
      )
      .run();
  }

  return {
    ok: true,
    written: entries.length,
  };
});
