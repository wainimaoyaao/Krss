# S3 MCP 出向端点守卫（2026-11-25）

## 问题
MCP 服务的地址是用户填的，但**服务回给 Krss 的地址不是**。三条路都能把 Krss 指到内网或云元数据端点（169.254.169.254）：

1. 旧 SSE 传输的 `event: endpoint` 事件——对方指定「往哪儿 POST」，原来直接采信；
2. HTTP 重定向——原来的 client 跟随到任意地址；
3. OAuth 发现链——`authorization_servers`、元数据里的 authorize/token/registration 端点原来没有约束。

## 改法
新增 `backend/internal/service/mcp/guard.go`：`NewEndpointGuard(base)` 按配置地址决定「这次会话能打到哪儿」。

- 配置地址是本机/内网（`127.0.0.1`、`localhost`、`.local`、`.internal`、私网字面量）→ 只许留在**同一个 host**；换 host 一律拒绝（自建 MCP 照常可用，本地开发不受影响）。
- 配置地址是公网 → 任何目标不许落在回环/私网/链路本地/保留段（`network.CheckPublicIPLiteral`），且 **https 不许降级成 http**。
- 协议只允许 http/https。
- `Client(base)` 返回挂好 `CheckRedirect` 的副本：重定向逐跳校验，最多 5 跳，不改调用方的 client。
- `CheckEndpointEvent(raw)`：SSE 的 endpoint 事件必须与配置地址**同源**（host + 端口）。

接入点：
- `backend/internal/service/mcp/client.go`：`NewClientWithTransport` 建守卫、包住 httpClient；`post()` 出网前 `CheckURL`。
- `backend/internal/service/mcp/sse.go`：GET 流前校验 sseURL；拿到 endpoint 事件后 `CheckEndpointEvent`。
- `backend/internal/service/mcp/oauth.go`：`DiscoverAuthServer` 建守卫；issuer 与元数据里的 authorize/token/registration 端点全部过 `CheckURL`；`RegisterClient` / `ExchangeCode` / `RefreshTokens` / `postToken` 增加 guard 参数并在出网前校验。
- `backend/internal/service/mcp_oauth.go`：`oauthHTTPClient` 用守卫包住 client，新增 `oauthGuard(server)`。

## 测试
新增 `backend/internal/service/mcp/guard_test.go`（8 项）与 `guard_e2e_test.go`（4 项）：

- 公网 base 拒绝 `127.0.0.1` / `169.254.169.254` / `10.0.0.5` / `192.168.1.1` / `[::1]` / `localhost`；放行 `https://auth.example.net/token`。
- `file://`、`ftp://` → `ErrEndpointScheme`；https → http 降级被拒。
- 本机 base：同 host 换端口可用；换 host（`10.0.0.5`、`127.0.0.2`）被拒。
- SSE endpoint 事件同源放行、换端口/换 host/元数据 IP 被拒。
- 真实 httptest：公网 base 的 client 跟随 302 到内网 → `ErrEndpointNotAllowed`；本机 base 的同 host 重定向正常通过；守卫不改调用方 client。
- 端到端：SSE 服务把 endpoint 事件指到 `localhost` → `Initialize` 直接失败；同源时正常列到工具；streamable-http 服务 302 到别的 host → 失败。

## 门禁（工作树 mcp-ssrf，2026-11-25）
- `go test ./... -race -v`：exit 0，**1,281** 项顶层测试，0 失败。
- `golangci-lint run`：`0 issues.`
- 前端 `bun run test`：168 文件 / 1,402 项通过；`bunx --no-install tsc -b` exit 0（本批未改前端，属回归确认）。

## 真实 HTTP 验收（127.0.0.1:8086，独立数据目录 `/tmp/krss-s3-data`）
受控服务：A `127.0.0.1:8098`（SSE，endpoint 事件指向同一服务的 `localhost` 名）；B `127.0.0.1:8097`（streamable-http，正常）。

```
('create attacker-sse', 201)
('test attacker-sse', 200, 'mcp endpoint is not allowed: 本机服务的会话不许打到 localhost')
('create legit-mcp', 201)
('test legit-mcp', 200, '{"name": null, "toolCount": 1, "error": null}')
```

服务端日志（`docs/dev/s3-evidence/server.log`）：

```
level=warn msg="mcp test failed" ... host=127.0.0.1:8098 error="mcp endpoint is not allowed: 本机服务的会话不许打到 localhost"
```

即：恶意 SSE 服务被挡在出网之前，同机合法 MCP 服务照常连通并列出工具。脚本 `docs/dev/s3-evidence/accept.py`（可重跑，登录/注册自动兜底）。

## 残余风险（已记录，未在本批处理）
- 公网域名走的是代理感知的普通 transport，**DNS 解析发生在拨号时**，理论上仍有 DNS rebinding 空间（要防它得把这个会话切到 `NewPublicHTTPClient` 的守卫拨号器，但会牺牲代理能力——国内访问公网 MCP 需要代理，故本批保留代理）。
- 用户自己填的公网 MCP 地址本身不做解析前置检查（用户显式选择的目标，与媒体代理的「内容里的 URL」不同类）。
