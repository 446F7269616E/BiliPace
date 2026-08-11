# Hourleaf 架构与数据契约

## 目标

Hourleaf 是本地优先、跨浏览器的网站专注扩展。核心目标是准确计时、确定执行用户规则、按需授权网站，并让站点适配可以独立演进而不进入通用内核。

## 分层

```text
popup / dashboard / plan / options / home
                    │
                    ▼
           application services
          ┌─────────┴──────────────┐
          ▼                        ▼
 generic focus core        local module gateway
          │           ┌────────────┼────────────┐
          │           ▼            ▼            ▼
          │      CSS/selectors   safe DNR   User Scripts API
          └───────────────┬───────────────┘
                    ▼
      storage / permissions / scripting / idle
                    ▼
     Chromium / Firefox / Safari build adapters
```

- `src/shared` 与 `src/core` 只包含通用领域模型、消息和浏览器端口。
- `src/background` 是可恢复的协调层，不依赖常驻 Service Worker。
- `src/content` 只报告可见性、焦点和路由状态，并渲染核心专注界面。
- `src/modules/local` 负责有界本地文件格式、双重校验、存储和平台执行适配。
- `optional-modules` 是仓库侧示例目录，不进入商店包，也不被运行时联网读取。
- UI 只调用版本化消息，不直接读写任意 storage key。
- 平台差异由浏览器适配层与构建 manifest 处理，业务层不按 UA 分支。

## 通用网站模型

设置 schema v3 使用三个稳定标识：

- `SiteId`：用户授权的精确来源，例如 `https://example.com`；
- `TargetId`：同一网站内可独立应用时间规则的目标；
- `SiteModuleId`：经过审核的可选站点能力包。

核心只保存来源与主机名，不保存普通浏览的路径、查询参数或页面标题。新增网站时必须由用户点击触发权限请求；授权模式为精确 `${origin}/*`。后台只为已启用且仍持有权限的网站注册动态 content script，启动或升级后从持久化设置重建注册状态。撤销权限或删除网站后停止计时与拦截。

普通网站默认有一个整站目标。站点模块可以声明多个稳定目标，但不能扩展到 manifest 未声明的主机。

## 商店核心与本地模块协议

商店包不包含网站专用可执行模块。旧 `SiteModuleDescriptor` 只保留迁移与源码兼容，发布目录为空，构建脚本不再输出 `modules/<site>.js`。

`LocalModuleDefinition` 是本地文件经导入器解析后的规范化声明：

- 固定模块 ID、版本、名称和精确 HTTP(S) 来源；
- `timed | always-allow | always-block` 域名策略；
- 有界元素选择器和自包含 CSS；
- 仅 `block | allow | upgradeScheme` 的安全 DNR 子集；
- 可选用户脚本文本，只能交给浏览器 User Scripts API。

导入器只读取用户在同一次文件选择中提供的 `.json`、`.css`、`.user.js`。清单不能包含远程依赖，核心不提供模块 URL 安装、GitHub API、自动更新、`eval`、`Function`、远程 `import` 或解释器。

发布形态：

- 每个平台只发布一个 Hourleaf 扩展，不要求用户安装第二个扩展；
- 模块先显示网站范围与能力，再由用户点击申请精确来源权限；
- 元素隐藏/CSS 由通用 content script 应用，CSS 远程加载语法被拒绝；
- DNR 运行时 ID 和发起域名由核心生成，模块不能把规则扩展到未声明网站；
- Chromium/Firefox 固定使用隔离 `USER_SCRIPT` world、顶层 frame、`document_idle`；
- Safari 商店构建拒绝用户脚本文件；
- 停用/删除模块会注销其用户脚本和动态 DNR 规则，本地文件内容随删除移除。

完整格式和平台能力矩阵见 [LOCAL_MODULES.md](./LOCAL_MODULES.md)。

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

计划清单接受用户主动添加的 HTTP/HTTPS URL，保存规范化 URL、来源、标题、顺序和完成状态。开始项目时创建精确绑定 `itemId + URL identity + expiresAt` 的授权；删除、完成、修改或到期会撤销授权。

计划页不暴露独立的“计划模式”启停开关。开始待办是进入计划访问的唯一显式入口；有效授权完成、删除、修改或到期后同步退出计划访问，避免形成没有退出路径的拦截状态。`PlanModeSettings.enabled` 暂时只作为兼容字段和运行时状态保留。

站点模块可提供更严格的身份，例如 Bilibili 模块把视频规范化为 BVID/canonical URL。核心计划不能依赖任何特定网站标识。

## 存储与迁移

为兼容既有安装，逻辑键暂时保持 `bilifocus.*`；品牌变更不直接重命名持久化键：

- `bilifocus.settings.v1`：当前值 schema v3；
- `bilifocus.usage.v1`：当前值 schema v2，权威字段为 `byTarget`；
- `bilifocus.temporary-access.v1`：当前值 schema v2；
- `bilifocus.plan-queue.v1`；
- `bilifocus.plan-access.v1`。
- `hourleaf.modules.v1`：旧预装模块迁移状态；商店构建初始化时清理；
- `hourleaf.local-modules.v1`：schema v1，保存用户本地导入的规范化模块与启用状态。

v1/v2 的 Bilibili 板块、计划和内容降噪设置继续作为只读兼容 capsule 保留，但商店构建不激活旧站点模块。迁移必须幂等、有界并保留无法识别的数据；损坏值回退到安全默认值。计划视图偏好使用 `hourleaf.plan.view`，仅允许 `list | mindmap`。

## 消息边界

消息使用 `{version, requestId, type, payload}`。后台必须验证发送方、URL 来源、权限、字段、长度、枚举与数组规模。本地模块在导入器和后台边界分别规范化；content script 只能读取当前 URL 对应的合并 CSS/选择器，不能读取用户脚本、全量模块、全量设置/历史、请求任意 Chrome API 或传入 storage key。扩展页才能执行模块导入、站点 CRUD、计划 CRUD 与数据清理。

## UI 与文案

固定居中置顶导航顺序为：仪表盘、计划、配置、设置。品牌、主导航和页面操作分别占据顶栏左、中、右区域；窄屏降级为四等分横向导航。各页职责保持单一：仪表盘只读展示聚合统计，计划页只承载待办/思维导图，配置页只管理网站时间规则，设置页只管理站点模块及插件级设置。所有页面共享 token、组件、状态和错误文案；站点模块只提供数据和能力，不拥有独立视觉系统。用户可见文本遵守 [UX_WRITING.md](./UX_WRITING.md)，不显示内部 provider、协议或调试建议。
