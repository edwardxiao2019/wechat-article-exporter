# wechat-article-exporter MCP Server

Cloudflare Workers 上的 [MCP](https://modelcontextprotocol.io/) 服务器，将微信公众号文章导出能力暴露给 AI 助手（Claude、Cursor 等）。

## 前提条件

| 条件 | 说明 |
|---|---|
| 已部署 wechat-article-exporter | 需要一个可访问的实例（Cloudflare Pages / Docker / 本地） |
| Cloudflare 账号 | 用于部署 Worker |
| [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) | `npm i -g wrangler` |

### 服务端环境变量

在 Cloudflare Workers 控制台或 `wrangler secret` 中配置：

| 变量 | 必填 | 说明 |
|---|---|---|
| `EXPORTER_BASE_URL` | **是** | wechat-article-exporter 实例地址，如 `https://your-site.pages.dev` |
| `MCP_API_KEY` | 否 | Bearer token，设置后所有请求须携带 `Authorization: Bearer <key>` |

## 部署

```bash
cd mcp-server
npm ci
wrangler secret put EXPORTER_BASE_URL   # 输入你的实例地址
wrangler secret put MCP_API_KEY         # 可选，设置访问密钥
wrangler deploy
```

部署成功后 Worker URL 格式为 `https://wechat-article-mcp.<your-subdomain>.workers.dev`。

## 工具列表

### 无需鉴权

| 工具 | 说明 |
|---|---|
| `download_article` | 下载文章内容，支持 markdown / text / html / json 格式 |
| `get_account_by_url` | 从文章链接提取公众号信息（含 fakeid） |
| `get_account_details` | 获取公众号详情（需服务端配置 `NUXT_WECHAT_ABOUT_BIZ_*` 环境变量） |
| `get_author_info` | 获取公众号主体元数据 |
| `get_auth_key` | 获取服务器会话对应的 auth_key，供鉴权工具使用 |
| `get_account_name` | 从文章链接快速获取公众号名称 |

### 需要 auth_key

> 先用 `get_auth_key` 工具获取令牌，或在 wechat-article-exporter 后台「设置 → 关于」页面复制。

| 工具 | 说明 |
|---|---|
| `search_accounts` | 按关键词搜索公众号 |
| `list_articles` | 获取指定公众号的文章列表（支持关键词过滤与分页） |
| `list_album` | 获取公众号合集（专辑）的文章列表 |

### 工具参数速查

<details>
<summary>download_article</summary>

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `url` | string | 是 | 微信文章链接 `https://mp.weixin.qq.com/s/...` |
| `format` | string | 否 | `markdown`（默认）/ `text` / `html` / `json` |
</details>

<details>
<summary>get_account_by_url / get_account_name</summary>

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `url` | string | 是 | 该公众号发布的任意文章链接 |
</details>

<details>
<summary>get_account_details / get_author_info</summary>

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `fakeid` | string | 是 | 公众号内部 ID（从 get_account_by_url 获取） |
</details>

<details>
<summary>search_accounts</summary>

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `auth_key` | string | 是 | 鉴权令牌 |
| `keyword` | string | 是 | 搜索关键词 |
| `begin` | integer | 否 | 分页偏移（默认 0） |
| `size` | integer | 否 | 返回数量（默认 5，最大 20） |
</details>

<details>
<summary>list_articles</summary>

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `auth_key` | string | 是 | 鉴权令牌 |
| `fakeid` | string | 是 | 公众号内部 ID |
| `keyword` | string | 否 | 标题关键词过滤 |
| `begin` | integer | 否 | 分页偏移（默认 0） |
| `size` | integer | 否 | 返回数量（默认 5，最大 20） |
</details>

<details>
<summary>list_album</summary>

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `fakeid` | string | 是 | 公众号内部 ID |
| `album_id` | string | 是 | 合集 ID |
| `count` | integer | 否 | 返回数量（默认 10，最大 20） |
| `begin_msgid` | string | 否 | 分页起始消息 ID |
| `begin_itemidx` | string | 否 | 分页起始索引 |
</details>

## Claude Desktop 配置

### 公开实例（无 MCP_API_KEY）

```json
{
  "mcpServers": {
    "wechat-article": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://wechat-article-mcp.<your-subdomain>.workers.dev/mcp"
      ]
    }
  }
}
```

### 带鉴权（设置了 MCP_API_KEY）

```json
{
  "mcpServers": {
    "wechat-article": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://wechat-article-mcp.<your-subdomain>.workers.dev/mcp",
        "--header",
        "Authorization: Bearer <your-mcp-api-key>"
      ]
    }
  }
}
```

## 开发

```bash
cd mcp-server
npm ci
wrangler dev   # 本地调试，监听 localhost:8787/mcp
```
