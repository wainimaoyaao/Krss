# B6/B7 刷新入场与结果（2026-11-25）

## 范围
统一手动与定时刷新由服务层入场；刷新期间重复请求返回 `ErrAlreadyRefreshing`；批次中存在失败时返回 `ErrRefreshPartial`，逐源结果仍通过状态接口保留；定时刷新日志区分跳过、部分失败与成功。

## 实测证据
- 后端：`go test ./... -race -v` 通过；`golangci-lint run` 输出 `0 issues.`。
- 前端：`bun run test`：168 个文件、1402 项通过；`bunx --no-install tsc -b` 通过。
- 定向：service/handler/scheduler race tests 通过。

## 备注
刷新触发来源在服务层成功取得入场后写入，避免被拒绝请求覆盖；处理器保留后台请求生命周期管理。
