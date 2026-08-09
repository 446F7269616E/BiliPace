# Hourleaf 架构与数据契约

## 目标

Hourleaf 是本地优先、跨浏览器的网站专注扩展。核心目标是准确计时、确定执行用户规则、按需授权网站，并让站点适配可以独立演进而不进入通用内核。

## 分层

```text
popup / dashboard / plan / options / home
                    │
                    ▼
           application services
          ┌─────────┴─────────┐
          ▼                   ▼
 generic site core      reviewed site modules
          │                   │
          └─────────┬─────────┘
                    ▼
      storage / permissions / scripting / idle
                    ▼
     Chromium / Firefox / Safari build adapters
```

- `src/shared` 与 `src/core` 只包含通用领域模型、消息和浏览器端口。
- `src/background` 是可恢复的协调层，不依赖常驻 Service Worker。
- `src/content` 只报告可见性、焦点和路由状态，并渲染核心专注界面。
- `src/modules/<site>` 拥有站点路由、选择器、内容降噪和可选身份适配。
- UI 只调用版本化消息，不直接读写任意 storage key。
- 平台差异由浏览器适配层与构建 manifest 处理，业务层不按 UA 分支。

## 通用网站模型

设置 schema v3 使用三个稳定标识：

- `SiteId`：用户授权的精确来源，例如 `https://example.com`；
- `TargetId`：同一网站内可独立应用时间规则的目标；
- `SiteModuleId`：经过审核的可选站点能力包。

核心只保存来源与主机名，不保存普通浏览的路径、查询参数或页面标题。新增网站时必须由用户点击触发权限请求；授权模式为精确 `${origin}/*`。后台只为已启用且仍持有权限的网站注册动态 content script，启动或升级后从持久化设置重建注册状态。撤销权限或删除网站后停止计时与拦截。

普通网站默认有一个整站目标。站点模块可以声明多个稳定目标，但不能扩展到 manifest 未声明的主机。

## 站点模块协议

`SiteModuleDescriptor` 是有界、可验证、可确定性序列化的声明：

- 固定模块 ID、版本、名称、主机和能力；
- 有限的路由与板块映射；
- 有限的 document/open ShadowRoot 内容 profile；
- 明确的生命周期事件和安全回退页面；
- 可选的计划身份适配。

运行时注册表只接受随构建一起审核的本地模块，不下载、`eval`、远程 `import` 或解释远程 JavaScript/Wasm。

发布形态：

- 每个平台只发布一个 Hourleaf 扩展，不要求用户安装第二个扩展；
- 所有经过审核的模块随签名包预装，默认停用且不持有网站权限；
- 通用 `content.js` 与 `modules/<site>.js` 分开构建，模块代码块仅在启用且已授权的来源注册；
- 删除模块会注销代码块、删除模块目标并写入 tombstone，后续页面不再加载它；
- 签名扩展不能在运行时物理删除包内文件，页面关闭或刷新后已注销模块不再占用运行内存；
- 恢复模块只恢复包内已审核代码的本地状态，不访问网络。

### Bilibili 模块

`hourleaf.site.bilibili` 包含 Bilibili 路由、板块、DOM 适配和开放 ShadowRoot 的安全兼容层。选择器失效时安全放行，不扫描 iframe，不启用 `all_frames`。模块不读取 Cookie、账号、私信、评论正文或完整观看历史。

## 计时模型

累计时间必须同时满足：

1. 当前来源已由用户配置和授权；
2. 对应网站与目标已启用；
3. 页面可见且窗口聚焦；
4. 设备未空闲或锁定；
5. 页面未被计划或时间规则阻断。

content script 发出 `start / heartbeat / route / stop`。后台按会话 ID 去重，心跳间隔超过上限视为中断；跨本地午夜拆分后写入每日桶。周/月统计只从每日桶汇总。普通计时只持久化 `TargetId + 日期 + 秒数`。

## 时间规则

规则是纯函数：`weekday + local time + target settings -> allow | block | defer`。

- 先按星期，再按 `HH:mm` 半开区间匹配；
- 跨午夜区间归属开始日并延续到次日；
- `allow` 优先于同一时刻的 `block`，并绕过每日额度；
- 只要存在启用的 allow 规则，未命中 allow 的时间默认不可用；
- 未命中显式规则时再应用每日额度；
- 临时访问是明确、限时且可计数的例外，不因后台重启延长。

## 计划

计划清单接受用户主动添加的 HTTP/HTTPS URL，保存规范化 URL、来源、标题、顺序和完成状态。开始项目时创建精确绑定 `itemId + URL identity + expiresAt` 的授权；删除、完成、修改、停用或到期会撤销授权。

站点模块可提供更严格的身份，例如 Bilibili 模块把视频规范化为 BVID/canonical URL。核心计划不能依赖任何特定网站标识。

## 存储与迁移

为兼容既有安装，逻辑键暂时保持 `bilifocus.*`；品牌变更不直接重命名持久化键：

- `bilifocus.settings.v1`：当前值 schema v3；
- `bilifocus.usage.v1`：当前值 schema v2，权威字段为 `byTarget`；
- `bilifocus.temporary-access.v1`：当前值 schema v2；
- `bilifocus.plan-queue.v1`；
- `bilifocus.plan-access.v1`。
- `hourleaf.modules.v1`：schema v2，保存预装模块状态与用户删除 tombstone。

v1/v2 的 Bilibili 板块、计划和内容降噪设置在读取时迁移为兼容 capsule，只有安装 Bilibili 模块时才映射到新目标。迁移必须幂等、有界并保留无法识别的数据；损坏值回退到安全默认值。计划视图偏好使用 `hourleaf.plan.view`，仅允许 `list | mindmap`。

## 消息边界

消息使用 `{version, requestId, type, payload}`。后台必须验证发送方、URL 来源、权限、字段、长度、枚举与数组规模。content script 不能读取全量设置/历史、安装模块、请求任意 Chrome API 或传入脚本/CSS/storage key。扩展页才能执行站点 CRUD、计划 CRUD 与数据清理。

## UI 与文案

固定左侧导航顺序为：仪表盘、计划、配置、设置。窄屏降级为横向导航。所有页面共享 token、组件、状态和错误文案；站点模块只提供数据和能力，不拥有独立视觉系统。用户可见文本遵守 [UX_WRITING.md](./UX_WRITING.md)，不显示内部 provider、协议或调试建议。
