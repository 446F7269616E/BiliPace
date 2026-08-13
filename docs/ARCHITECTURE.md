# Hourleaf 架构与数据契约

## 目标

Hourleaf 是本地优先、跨浏览器的网站专注扩展。核心目标是准确计时、确定执行用户规则、按需授权网站，并让站点适配可以独立演进而不进入通用内核。

## 分层

```text
popup / dashboard / plan / options / home / end
                    │
                    ▼
           application services
          ┌─────────┴──────────────┐
          ▼                        ▼
 generic focus core        local module gateway
          │           ┌────────────┼────────────┐
          │           ▼            ▼            ▼
          │      CSS/selectors              User Scripts API
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

设置 schema v4 使用三个稳定标识：

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
- 非空 DNR 规则被拒绝，避免域名级规则越过精确 origin 边界；
- 可选用户脚本文本，只能交给浏览器 User Scripts API。

导入器只读取用户在同一次文件选择中提供的 `.json`、`.css`、`.user.js`。清单不能包含远程依赖，核心不提供模块 URL 安装、GitHub API、自动更新、`eval`、`Function`、远程 `import` 或解释器。

发布形态：

- 每个平台只发布一个 Hourleaf 扩展，不要求用户安装第二个扩展；
- 模块先显示网站范围与能力，再由用户点击申请精确来源权限；
- 元素隐藏/CSS 由通用 content script 应用，CSS 远程加载语法被拒绝；
- Chromium/Firefox 固定使用隔离 `USER_SCRIPT` world、顶层 frame、`document_idle`；
- Safari 商店构建拒绝用户脚本文件；
- 停用/删除模块会注销其用户脚本，本地文件内容随删除移除；初始化同时清理旧版本遗留的自有 DNR 规则。

完整格式和平台能力矩阵见 [LOCAL_MODULES.md](./LOCAL_MODULES.md)。

## 计时模型

累计时间必须同时满足：

1. 当前来源已由用户配置和授权；
2. 对应网站与目标已启用；
3. 页面可见且窗口聚焦；
4. 设备未空闲或锁定；
5. 页面未被计划或时间规则阻断。

content script 发出 `start / heartbeat / route / stop`。后台按会话 ID 去重，心跳间隔超过上限视为中断；跨本地午夜拆分后写入每日桶。周/月统计只从每日桶汇总。普通计时持久化 `TargetId + TimePeriodId + 日期 + 聚合秒数`，不保存页面 URL。

## 时间规则

规则是纯函数：`weekday + local time + target settings + period usage + runtime -> allow | block | defer`。

- 每个目标拥有多个 `TimePeriodSettings`；新目标默认每天 `00:00–00:00` 全天时段，额度为空、1 组，按本地 0 点刷新；
- 网站和目标级 `enabled` 仅保留为旧数据兼容镜像并在读取时归一为 `true`；用户可见的启停边界只有 `timePeriods[].enabled`，避免隐藏总开关覆盖时间段状态；
- 先按星期，再按 `HH:mm` 半开区间匹配；相同起止时间表示所选日期全天，跨午夜按开始日延续；
- 重叠时优先级为 `always-allow > always-block > timed`，未命中任何时段时不可用；
- `timed` 时段拥有独立额度和 1–24 个等分组；组运行状态与统计分离，避免污染长期设置；
- `lenient` 到期只提醒，`flow` 到期允许一次 1–15 分钟或视频结束延时，`strict` 直接进入结束页；
- 下一组可直接开启、等待、完成数学题或比对本地 SHA-256 密码校验值；密码只增加操作摩擦，不是账户安全边界；
- 结束页是独立扩展页面，不跳转到设置/仪表盘主页面；默认显示当日摘要，可改为激励文字或简洁提示。
- 每个网站可独立开启“访问前确认”及 0–60 秒等待；它只在其他规则已允许访问时生效，不复用结束页分组解锁状态。确认授权只覆盖当前标签页在该 origin 的连续访问，离开 origin、关闭标签或更改网站策略后失效；会话存储仅保存 `tabId + SiteId + origin + 策略版本`，不保存页面路径。

## 计划

计划清单接受用户主动添加的 HTTP/HTTPS URL，保存规范化 URL、来源、标题、顺序、完成状态、事项级预定时长和到期模式。只有用户点击“开始”时才请求该事项精确 origin 的可选网站权限；后台二次验证权限后，用唯一固定 ID 为当前 active grant 注册 `content.js`，不会批量注册整个队列，也不会改动 focus 网站的注册。开始项目时创建精确绑定 `itemId + URL identity + expiresAt + completionMode` 的授权；删除、完成、修改、停止或到期会撤销授权并对该固定注册执行 reconcile。后台启动时只会为仍有效或等待一次心流选择的授权恢复注册。可选的 `autoCompleteOnStart` 默认关闭。

计划到期沿用宽容 / 心流 / 严格语义。心流授权只能延时一次，分钟选项限制为 1–15；“视频结束”是独立的显式授权状态，不使用分钟过期时间，只由内容脚本绑定的当前视频在 `ended` 时发送 STOP，或由其他显式停止操作撤销。存储使用 `Number.MAX_SAFE_INTEGER` 作为不触发普通到期分支的持久化哨兵值，旧版 15 分钟视频结束授权在读取时迁移为该状态。

计划页不暴露独立的“计划模式”启停开关。开始待办是进入计划访问的唯一显式入口；有效授权完成、删除、修改或到期后同步退出计划访问，避免形成没有退出路径的拦截状态。`PlanModeSettings.enabled` 暂时只作为兼容字段和运行时状态保留。

计划列表使用自适应网格展示待办，已完成区域默认折叠并在页面会话内保留展开状态。思维导图使用独立的大画布 viewport：节点按统一列宽和真实内容高度参与布局，长链接最多显示两行且不越过节点；画布支持空白区域拖动、指针中心缩放、键盘平移和 `fit view`。适配算法只依赖场景与 viewport 的实际边界并保留内边距，最低概览比例覆盖 500 个事项；分支主干按折叠或展开后的真实节点中心重新测量，避免固定百分比连线错位。普通滚轮保留页面滚动，只有 `Ctrl/⌘` 加滚轮执行画布缩放。实现避免引入重量级图编辑器依赖。

站点模块可提供更严格的身份，例如 Bilibili 模块把视频规范化为 BVID/canonical URL。核心计划不能依赖任何特定网站标识。

## 存储与迁移

为兼容既有安装，逻辑键暂时保持 `bilifocus.*`；品牌变更不直接重命名持久化键：

- `bilifocus.settings.v1`：当前值 schema v4；
- `bilifocus.usage.v1`：当前值 schema v3，权威字段为 `byTarget` 与 `byPeriod`；
- `bilifocus.temporary-access.v1`：当前值 schema v2；
- `bilifocus.plan-queue.v1`；
- `bilifocus.plan-access.v1`。
- `hourleaf.period-runtime.v1`：schema v1，保存每日分组解锁和一次性心流延时状态；
- `hourleaf.modules.v1`：旧预装模块迁移状态；商店构建初始化时清理；
- `hourleaf.local-modules.v1`：schema v1，保存用户本地导入的规范化模块与启用状态。

v1/v2 的 Bilibili 板块、计划和内容降噪设置继续作为只读兼容 capsule 保留，但商店构建不激活旧站点模块。迁移必须幂等、有界并保留无法识别的数据；损坏值回退到安全默认值。计划视图偏好使用 `hourleaf.plan.view`，仅允许 `list | mindmap`。

## 消息边界

访问确认只能由同一标签页中的扩展确认页授权，后台会再次匹配已配置网站、精确 origin、策略版本和等待截止时间。

消息使用 `{version, requestId, type, payload}`。后台必须验证发送方、URL 来源、权限、字段、长度、枚举与数组规模。网站心流消息还要校验发送标签页同源、目标和时段；计划判定/延时/停止消息校验 sender 与声明 URL 同源且当前 origin 仍有 host permission，但不要求该 origin 已加入 focus 网站，精确事项与 URL 校验仍在 `PlanService` 边界完成；分组解锁仅允许扩展页。本地模块在导入器和后台边界分别规范化；content script 只能读取当前 URL 对应的合并 CSS/选择器，不能读取用户脚本、全量模块、全量设置/历史、请求任意 Chrome API 或传入 storage key。扩展页才能执行模块导入、站点 CRUD、计划 CRUD 与数据清理。

## UI 与文案

固定居中置顶导航顺序为：仪表盘、计划、配置、设置。品牌、主导航和页面操作分别占据顶栏左、中、右区域；窄屏降级为四等分横向导航。各页职责保持单一：仪表盘只读展示聚合统计，计划页只承载待办/思维导图，配置页只管理网站时间段，设置页只管理站点模块、语言、计划自动完成与结束页。配置页不提供人工保存按钮：限制模式和时间段变更通过串行领域消息实时持久化，状态区只反馈保存中、已保存或失败，且不得用完整设置快照覆盖其他页面的并发设置。所有页面通过 `src/shared/i18n.ts` 的稳定键共享简体中文/英文资源，manifest 使用标准 `_locales`；站点模块只提供数据和能力，不拥有独立视觉系统。用户可见文本遵守 [UX_WRITING.md](./UX_WRITING.md)，不显示内部 provider、协议或调试建议。

配置页编辑采用即时调度的自动保存，并用单一串行写循环合并快速连续操作；写入期间的新编辑会在前一次完成后继续保存，不显示手动保存按钮。限制模式通过 `UPDATE_MANAGED_SITE` 保存，时间段通过 `UPDATE_SITE_TARGET` 保存，避免陈旧配置页覆盖语言、结束页等其他设置。导航只提供可读的“未保存 / 保存中 / 已保存 / 失败”状态，失败时显示语义明确的重试按钮。限制模式与网站身份分别使用独立卡片，避免与时间段开关混淆。设置页内容在宽屏居中，字段使用稳定的说明列/控件列网格，窄屏降为单列。

Popup 每次刷新都重新查询当前活动标签，并监听标签激活、URL 变化、可见性与设置变化；服务端数据以 5 秒为上限对齐，两次对齐之间仅在已确认正在计时时本地递增展示，不频繁写存储。当前剩余时间只从 `PageDecision.activePeriodId + UsageSummary.byPeriod` 计算，不读取已废弃的目标级日限额。`showRemainingMinutesOnIcon` 默认开启；后台为每个活动标签设置剩余整分钟 badge，仅在命中有限额的当前时间段时显示，未配置、无限额、非 HTTP(S)、全局暂停或关闭该选项时清空。

限制模式和计划到期方式共享“短模式名 + 选择控件下方常显说明”的表达：选项只显示宽容、心流、严格，说明随选择即时更新。设置页用原生 `details / summary` 组织常规、结束页面、数据管理和已导入模块，保留键盘与读屏原生语义；插件图标剩余分钟开关默认启用。模块导入弹窗只保留文件选择、结构化预览和必须确认的安全免责，不重复展示格式规范或内部风险标题。

所有设置写入，包括站点和模块的新增、删除及清单应用，都通过 `SettingsRepository` 的同一读改写事务队列；领域服务不得在队列外读取后再提交整份旧快照。限制模式更新只修改站点模式，不重放模块清单或重建无关注册。
