# B6/B7 刷新入场与结果（2026-11-25）

## 范围
手动刷新（全量/按范围）与定时刷新由服务层统一准入；刷新进行中重复请求返回 `ErrAlreadyRefreshing`；批次内存在失败时返回 `ErrRefreshPartial`，逐源结果仍通过状态接口返回；定时刷新日志区分成功、部分失败、跳过；触发来源与准入在同一把锁内写入，被拒绝的请求不再改写正在执行那一轮的 `trigger`。

## 代码改动
- `backend/internal/service/refresh_service.go`：新增 `ErrRefreshPartial`、`refreshHadFailures()`；`refreshAll` / `refreshFeeds` 结束后按结果返回 `ErrRefreshPartial` 或 nil；`lastTrigger` 从入口方法移入准入临界区（`auto` 判据在 `refreshAll`、范围刷新为 `manual`），范围刷新补写 `lastRefreshedAt`。
- `backend/internal/scheduler/scheduler.go`：`ErrAlreadyRefreshing` → `scheduled feed refresh skipped`（result=skipped, reason=already_refreshing）；`ErrRefreshPartial` → `scheduled feed refresh completed with failures`（result=partial）；其余保持原有 cancelled / failed 分支。
- `backend/internal/handler/feed_handler.go`：后台刷新日志不再把 `ErrRefreshPartial` 记成 error（逐源失败已由状态接口呈现）。
- 测试：`backend/internal/service/refresh_service_test.go` 新增 `TestRefreshService_RefreshAll_PartialResultReturnsError`、`TestRefreshService_RejectedRequestKeepsRunningTrigger`、`TestRefreshService_RefreshFeeds_PartialResultReturnsError`；`backend/internal/service/export_test.go` 新增 `SetRefreshServiceRunningState`。

## 门禁（2026-11-25，工作树 refresh-admission-v2）
- 后端 `go test ./... -race -v`：exit 0，1,269 项顶层测试，0 失败，23 个包 ok。
- 后端 `golangci-lint run`：`0 issues.`
- 前端 `bun run test`：168 文件 / 1,402 项通过；`bunx --no-install tsc -b`：exit 0。

## 真实 HTTP / 调度验收（127.0.0.1:8085，独立 `KRSS_DATA_DIR=/tmp/krss-ra-data`，受控源 127.0.0.1:8099）
受控源：`/good.xml` 200、`/bad` 500、`/slow` 120 秒后才回 200；三个订阅分别指向它们。抓取设置 `intervalMinutes=1, concurrency=4, timeoutSeconds=300`。

1. 手动连续两次 `POST /api/feeds/refresh`：`204` → `409`；期间 `GET /api/feeds/refresh` 返回 `isRefreshing=true, trigger=manual`。
2. 一轮手动刷新结束（17:22:22）后状态接口返回逐源结果：good `new=0`、bad `error="HTTP 500"`、slow `new=1`，`trigger=manual`；服务日志 `refresh completed with failures ... result=partial count=3`。
3. 定时轮与手动互斥：17:22:37 定时轮运行中两次手动 POST 均返回 `409`（真实 HTTP）。
4. 定时轮部分失败：17:23:29 `scheduled feed refresh completed with failures ... result=partial`（bad 500 + slow 超时）。
5. 定时轮跳过：17:24:29 与 17:25:29 手动刷新仍在进行，日志 `scheduled feed refresh skipped ... result=skipped reason=already_refreshing`。
6. 拒绝不改写来源：定时轮运行中（`trigger=auto`）手动 POST 返回 `409`，随后状态接口 `trigger` 仍为 `auto`。

原始日志筛选见 `docs/dev/b6b7-evidence/scheduler-and-http.log`（`/tmp/krss-ra.log`、`/tmp/krss-ra2.log` 摘录）。

## 备注
- 未合并、未推送；主树无关的 `AGENTS.md` / `docs/agents/` 改动未触碰。
- 前端未改动；前端门禁为回归确认。
