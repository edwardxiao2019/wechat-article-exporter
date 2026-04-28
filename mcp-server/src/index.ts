/**
 * Wechat Article Exporter — MCP Server (Cloudflare Worker)
 * Protocol: MCP 2024-11-05 over Streamable HTTP (POST /mcp)
 */

interface Env {
  EXPORTER_BASE_URL: string;
  MCP_API_KEY?: string;
}

// ── Tool definitions (JSON Schema) ───────────────────────────────────────────

const TOOLS = [
  {
    name: 'download_article',
    description: '下载微信公众号文章内容，返回指定格式（markdown / text / html / json）。需要 auth_key。',
    inputSchema: {
      type: 'object',
      properties: {
        auth_key: { type: 'string', description: '鉴权令牌，登录后从 exporter 设置页面复制' },
        url: { type: 'string', description: '微信文章链接，格式：https://mp.weixin.qq.com/s/...' },
        format: {
          type: 'string',
          enum: ['markdown', 'text', 'html', 'json'],
          default: 'markdown',
          description: '输出格式，默认 markdown',
        },
      },
      required: ['auth_key', 'url'],
    },
  },
  {
    name: 'get_account_by_url',
    description: '从微信文章链接提取公众号信息，返回包含 fakeid 的 JSON。fakeid 是其他工具的必需参数。',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '该公众号发布的任意文章链接' },
      },
      required: ['url'],
    },
  },
  {
    name: 'get_account_details',
    description:
      '获取公众号详细资料：简介、微信号、认证信息、历史名称、IP 归属地等。注意：需要服务端配置 NUXT_WECHAT_ABOUT_BIZ_WX_HEADER / NUXT_WECHAT_ABOUT_BIZ_UIN / NUXT_WECHAT_ABOUT_BIZ_KEY 等环境变量，否则返回"密钥已过期"。',
    inputSchema: {
      type: 'object',
      properties: {
        fakeid: { type: 'string', description: '公众号内部 ID（从 get_account_by_url 或 search_accounts 获取）' },
      },
      required: ['fakeid'],
    },
  },
  {
    name: 'get_author_info',
    description: '获取公众号作者或机构的元数据',
    inputSchema: {
      type: 'object',
      properties: {
        fakeid: { type: 'string', description: '公众号内部 ID' },
      },
      required: ['fakeid'],
    },
  },
  {
    name: 'search_accounts',
    description: '按关键词搜索微信公众号，返回匹配的公众号列表（含 fakeid）。需要 auth_key。',
    inputSchema: {
      type: 'object',
      properties: {
        auth_key: { type: 'string', description: '鉴权令牌，登录后从 /api/public/v1/authkey 获取' },
        keyword: { type: 'string', description: '搜索关键词' },
        begin: { type: 'integer', minimum: 0, default: 0, description: '分页起始偏移' },
        size: { type: 'integer', minimum: 1, maximum: 20, default: 5, description: '返回数量' },
      },
      required: ['auth_key', 'keyword'],
    },
  },
  {
    name: 'list_articles',
    description: '获取指定公众号的文章列表，支持关键词过滤和分页。需要 auth_key。',
    inputSchema: {
      type: 'object',
      properties: {
        auth_key: { type: 'string', description: '鉴权令牌' },
        fakeid: { type: 'string', description: '公众号内部 ID' },
        keyword: { type: 'string', description: '文章标题关键词过滤（可选）' },
        begin: { type: 'integer', minimum: 0, default: 0, description: '分页起始偏移' },
        size: { type: 'integer', minimum: 1, maximum: 20, default: 5, description: '返回数量' },
      },
      required: ['auth_key', 'fakeid'],
    },
  },
  {
    name: 'get_auth_key',
    description:
      '尝试从服务器会话获取 auth_key（API 令牌）。仅当 exporter 服务端已有有效登录会话（cookie）时才能成功。若失败，请直接从 exporter 设置页面复制 auth_key 手动提供给其他工具。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_album',
    description: '获取公众号指定合集（专辑）的文章列表，支持分页。',
    inputSchema: {
      type: 'object',
      properties: {
        fakeid: { type: 'string', description: '公众号内部 ID（从 get_account_by_url 或 search_accounts 获取）' },
        album_id: { type: 'string', description: '合集 ID' },
        count: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: '返回数量' },
        begin_msgid: { type: 'string', description: '分页起始消息 ID（可选）' },
        begin_itemidx: { type: 'string', description: '分页起始索引（可选）' },
      },
      required: ['fakeid', 'album_id'],
    },
  },
  {
    name: 'get_account_name',
    description: '从微信文章链接快速获取公众号名称，无需 fakeid。',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '该公众号发布的任意文章链接' },
      },
      required: ['url'],
    },
  },
] as const;

// ── Tool execution ────────────────────────────────────────────────────────────

async function executeTool(name: string, args: Record<string, unknown>, base: string): Promise<string> {
  const get = async (path: string, params: Record<string, unknown>, headers?: HeadersInit) => {
    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`上游请求失败: ${res.status} ${res.statusText}`);
    return res.text();
  };

  switch (name) {
    case 'download_article':
      return get(
        '/api/public/v1/download',
        { url: args.url, format: args.format ?? 'markdown' },
        { 'X-Auth-Key': String(args.auth_key) }
      );

    case 'get_account_by_url':
      return get('/api/public/v1/accountbyurl', { url: args.url });

    case 'get_account_details':
      return get('/api/public/beta/aboutbiz', { fakeid: args.fakeid });

    case 'get_author_info':
      return get('/api/public/beta/authorinfo', { fakeid: args.fakeid });

    case 'search_accounts':
      return get(
        '/api/public/v1/account',
        { keyword: args.keyword, begin: args.begin ?? 0, size: args.size ?? 5 },
        { 'X-Auth-Key': String(args.auth_key) }
      );

    case 'list_articles': {
      const params: Record<string, unknown> = {
        fakeid: args.fakeid,
        begin: args.begin ?? 0,
        size: args.size ?? 5,
      };
      if (args.keyword) params.keyword = args.keyword;
      return get('/api/public/v1/article', params, { 'X-Auth-Key': String(args.auth_key) });
    }

    case 'get_auth_key':
      return get('/api/public/v1/authkey', {});

    case 'list_album':
      return get('/api/web/misc/appmsgalbum', {
        fakeid: args.fakeid,
        album_id: args.album_id,
        count: args.count ?? 10,
        begin_msgid: args.begin_msgid,
        begin_itemidx: args.begin_itemidx,
      });

    case 'get_account_name':
      return get('/api/web/misc/accountname', { url: args.url });

    default:
      throw new Error(`未知工具: ${name}`);
  }
}

// ── MCP JSON-RPC handler ──────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function rpcOk(id: unknown, result: unknown) {
  return json({ jsonrpc: '2.0', result, id });
}

function rpcErr(id: unknown, code: number, message: string) {
  return json({ jsonrpc: '2.0', error: { code, message }, id });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (env.MCP_API_KEY) {
      const auth = request.headers.get('Authorization') ?? '';
      if (auth !== `Bearer ${env.MCP_API_KEY}`) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...CORS },
        });
      }
    }

    if (url.pathname !== '/mcp') {
      return new Response('Not found', { status: 404 });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS });
    }

    let body: { jsonrpc: string; method: string; params?: unknown; id?: unknown };
    try {
      body = await request.json();
    } catch {
      return rpcErr(null, -32700, 'Parse error');
    }

    const { method, params, id } = body;
    const base = env.EXPORTER_BASE_URL;
    if (!base) {
      return rpcErr(id ?? null, -32603, 'EXPORTER_BASE_URL 未配置');
    }
    const p = (params ?? {}) as Record<string, unknown>;

    if (method === 'initialize') {
      return rpcOk(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'wechat-article-exporter', version: '1.0.0' },
      });
    }

    if (method === 'notifications/initialized') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (method === 'tools/list') {
      return rpcOk(id, { tools: TOOLS });
    }

    if (method === 'tools/call') {
      const { name, arguments: args = {} } = p as { name: string; arguments?: Record<string, unknown> };
      try {
        const text = await executeTool(name, args, base);
        try {
          const parsed = JSON.parse(text);
          if (parsed?.base_resp?.ret !== undefined && parsed.base_resp.ret !== 0) {
            return rpcOk(id, { content: [{ type: 'text', text }], isError: true });
          }
        } catch {}
        return rpcOk(id, { content: [{ type: 'text', text }] });
      } catch (err) {
        return rpcErr(id, -32603, String(err));
      }
    }

    return rpcErr(id, -32601, `Method not found: ${method}`);
  },
} satisfies ExportedHandler<Env>;
