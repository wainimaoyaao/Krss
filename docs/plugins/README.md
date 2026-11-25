# Krss 插件开发

Krss 的插件把「特化能力的实现」从本体里拆出来：本体继续管阅读体验与管理，Bark 推送、RSSHub 适配、GitHub 头像这类能力由插件提供。插件可以启停，但**不能改变本体行为语义**。

插件有两条轨道，同一份 Go 契约：

| 轨道 | 形态 | 怎么装 | 能否卸载 |
| --- | --- | --- | --- |
| 内置（builtin） | 编译进 `krss` 二进制 | 改代码、重新编译 | 不能，只能停用 |
| 外部（http） | 独立进程 + Unix socket | 设置 → 插件 →「添加插件」上传 zip，或放进数据目录 `plugins/<id>/` | 能，目录归档、数据清空 |

外部插件是**即装即用**的：上传后默认停用，确认来源可信再打开开关。宿主不把插件当成安全边界——插件的 `permissions` 是能力声明，不是沙箱；安装外部插件等于在本机运行它的代码。

## 信任模型：装插件等于让它在你的机器上跑

这一段把边界写清楚，别靠猜：

**宿主不做的事**

- 不给插件沙箱。外部插件是普通的 OS 进程（`exec` 起 `plugin.json` 里的 `entrypoint`），与 `krss` 同用户、同文件系统视图，没有 namespace / seccomp / chroot。
- 不按 `permissions` 做逐项拦截。`permissions` 是**声明**，用来告诉用户「这个插件会碰什么数据」，对外部插件的 SDK 调用不做逐条校验；视图侧才有沙箱 bridge 按声明的权限决定给不给 `data` / `entries:read`。
- 不验证插件来源与签名。上传的 zip 由你自己确认可信。
- 不隔离网络。插件能自己发起任意出站连接，宿主也不知道它连了哪里。

**所以一个插件能做的事**：读宿主数据目录（含 `krss.db` 与设置里的第三方凭证）、通过 socket 调宿主 API（拿订阅与条目、写自己的插件数据）、读写自己的插件目录、起子进程。这就是「本机代码」的等价权限。

**宿主确实做了的收口**

- **环境变量白名单**：子进程环境只放行 `PATH`/`HOME`/`TMP*`/`LANG`/`LC_ALL`/`TZ`/`SSL_CERT*`/`*_PROXY`，再加 `KRSS_PLUGIN_SOCKET`、`KRSS_PLUGIN_TOKEN`、`KRSS_PLUGIN_ID`、`KRSS_PLUGIN_API` 四个注入项；**不继承**宿主其余环境（数据库密码、第三方 key 不会顺带漏给插件）。见 `backend/internal/service/plugin_host.go` 的 `pluginChildEnv`。
- 插件日志按 `0600` 建（`openPluginLog`）。
- 崩溃看护：指数退避重启，连续崩 ≥5 次标 `crashed` 停看护，不会无限拉。
- 上传后默认**停用**，开关是你给的。

**部署隔离（想跑不太可信的插件时）**

1. 把 Krss 放进单独容器/单独用户跑，插件跟着一起隔离，宿主机的其它数据就与它无关；
2. 数据目录按 0700、库文件按 0600（启动时自动收紧，见 `docs/dev/archive/` 里 S5 那批），同机其它用户读不到；
3. 不要给插件目录挂共享卷，也不要把宿主的密钥放进 Krss 进程的环境变量里——白名单之外本来就传不进去，但同一台机上的其它进程能读 `/proc/<pid>/environ`（Linux，需同用户或 root）；
4. 真要把插件当不可信代码，就别用原生插件轨道：那是本机代码，不是扩展机制里的沙箱。

## 5 分钟跑通一个外部插件

1. 新建目录 `my-plugin/`，写 `plugin.json`（字段见 [manifest.md](manifest.md)）：

   ```json
   {
     "id": "my-plugin",
     "name": "我的插件",
     "version": "0.1.0",
     "transport": "http",
     "entrypoint": "./my-plugin",
     "autostart": false,
     "permissions": ["entries:read"],
     "contributions": [],
     "views": []
   }
   ```

2. 写 `main.go`，用 SDK 托管（完整可运行示例见 `backend/cmd/examples/hello-menu/`）。注意 SDK 是 `krss/backend/internal/...` 的 internal 包，插件源码必须放在 backend 模块内（例如 `backend/cmd/my-plugin/`）；树外独立 module 无法直接 import internal 包：

   ```go
   package main

   import (
       "context"
       "krss/backend/internal/plugin"
       "krss/backend/internal/plugin/sdk"
   )

   type Plugin struct{}

   func (Plugin) Meta() plugin.Meta {
       return plugin.Meta{ID: "my-plugin", Name: "我的插件", Version: "0.1.0"}
   }
   func (Plugin) Actions() []plugin.Action                   { return nil }
   func (Plugin) SettingsSections() []plugin.SettingsSection { return nil }
   func (Plugin) EntryProcessors() []plugin.EntryProcessor   { return nil }
   func (Plugin) FetchClassifiers() []plugin.FetchClassifier { return nil }

   func main() {
       if err := sdk.Serve(context.Background(), Plugin{}); err != nil {
           panic(err)
       }
   }
   ```

3. 编译成可执行文件，命名为 `plugin.json` 里 `entrypoint` 指向的名字：

   ```bash
   cd my-plugin
   GOCACHE=/tmp/krss-gocache go build -o my-plugin .
   ```

4. 打包：`plugin.json` 放在 zip 根目录（或唯一顶层目录里）：

   ```bash
   zip -r my-plugin.zip plugin.json my-plugin
   ```

5. 打开 Krss → 设置 → 插件 →「添加插件」，选中 zip。安装成功后插件默认是「已停用」，打开开关后宿主会启动进程并握手。安装说明文字就在上传按钮下方。

## 插件能扩展什么

| 扩展点 | Go 接口 | 用途 |
| --- | --- | --- |
| 自动化动作 | `plugin.Action` | 过滤规则命中后执行动作（如推送） |
| 设置段 | `plugin.SettingsSection` | 在设置 → 插件里渲染配置表单 |
| 阅读期处理 | `plugin.EntryProcessor` | 对某类订阅源的条目做正文加工 |
| 抓取失败归类 | `plugin.FetchClassifier` | 把 403/验证码/RSSHub 错误翻成人话 |
| 界面贡献 | `plugin.ContributionsProvider` | 右键菜单、工具栏、正文浮动条等 9 个挂点 |
| 界面直调 | `plugin.Invoker` | 界面点按钮直接调用插件动作 |
| 自定义视图 | `plugin.ViewProvider` + `plugin.UIAssets` | 视图切换器里的沙箱 iframe 页面 |
| 正文装饰 | `plugin.RenderDecorator` | 高亮/下划线/批注区间，DOM 由宿主画 |
| 订阅源图标 | `plugin.FeedIconProvider` | 为订阅源提供头像/图标 URL |

接口签名与示例见 [go-api.md](go-api.md)；外部进程协议见 [protocol.md](protocol.md)；沙箱页面与 bridge 见 [ui.md](ui.md)。

## 生命周期与排障

- **发现**：宿主每 5 秒扫一次数据目录 `plugins/`。只认目录里的 `plugin.json`，目录名必须等于 `id`。名字里含 `.removed-` 的目录（形如 `<id>.removed-<UTC>`）是卸载归档，不会被扫描。
- **首次发现**：外部插件一律写入 `plugins` 表并置为**停用**；用户明确打开后才启动。
- **启动**：插件 SDK 自己 `net.Listen` 创建 `plugins/<id>/plugin.sock` 并 `Chmod 0600`；宿主只注入路径与环境变量 `KRSS_PLUGIN_SOCKET`、`KRSS_PLUGIN_TOKEN`、`KRSS_PLUGIN_ID`、`KRSS_PLUGIN_API`。插件进程只继承最小白名单环境变量，不再继承服务端全部环境。
- **协议**：宿主拉 `/meta`，校验 `apiVersion`。版本不兼容时**不重启**，只在插件卡片显示错误，避免旧二进制被反复拉起。
- **崩溃**：单个插件连续崩溃 5 次后停止看护并显示 `lastError`；其他插件不受影响。
- **日志**：`plugins/<id>/plugin.log`，启动时超过 5MB 会轮转。
- **读路径超时**：`EntryProcessor` 由宿主按单个插件 2 秒超时注入 `ctx`；插件必须尊重 `ctx.Done()`，否则宿主仍可能被同步调用拖住。
- **卸载**：外部插件目录改名为 `<id>.removed-<UTC>` 归档，同时清 `plugin_data`、`plugin.<id>.*` 设置和 `plugins` 行；内置插件只能停用。

## 安全边界

- 外部插件 = 本机代码。只在信任来源时安装、启用。
- `permissions` 只控制宿主**给插件多少数据**（例如 `entries:read` / `entries:full` / `data` / `ui:custom`），不是进程隔离。
- 插件界面跑在 `sandbox="allow-scripts"` 的 iframe 里：拿不到宿主 DOM、cookie、localStorage，`connect-src 'none'` 禁止 fetch/XHR/WebSocket；与宿主只通过 `postMessage` bridge 通信，bridge 按 `permissions` 放行。
- 插件设置里 `type: "secret"` 的字段会从设置导出中排除，界面回显时掩码。

## 相关文档

- [manifest.md](manifest.md) —— `plugin.json` 每个字段
- [go-api.md](go-api.md) —— Go 接口、请求/响应结构、权限
- [protocol.md](protocol.md) —— 外部进程 Unix socket + JSON 协议
- [ui.md](ui.md) —— 界面贡献、挂点、沙箱 bridge v1
- 运行时 HTTP API 见 `GET /swagger/index.html` 的 `plugins` 分组
