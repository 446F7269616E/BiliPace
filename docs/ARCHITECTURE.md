# BiliFocus 架构与质量约束

## 目标

BiliFocus 是本地优先、跨浏览器的 WebExtension。架构优先保证：准确计时、确定性计划、最小权限、可迁移数据和 Bilibili 页面变化下的可恢复性。

## 分层与依赖方向

```text
popup / options / dashboard / plan
            │
            ▼
     application services  ◄──── content script（只采集页面状态/渲染遮罩）
            │
            ▼
 domain: route / schedule / timer / statistics
            │
            ▼
 ports: clock / storage / alarms / runtime messaging
            │
            ▼
adapters: Chromium SW / Firefox event page / Safari WebExtension
```

- `domain` 必须是无浏览器全局变量的纯逻辑，时间与存储通过接口注入。
- UI 只能调用 application service，不直接解释统计记录或计划规则。
- content script 不持有权威统计，只报告标准化事件并渲染由应用层下发的状态。
- 特权 background 是协调者而不是常驻进程（Chromium Service Worker、Firefox 非持久事件页、Safari 的目标环境）；重启后可从 schema 化存储恢复。
- 平台差异封装在 adapter/build manifest 层，禁止在业务代码里按 UA 分支。

## 页面分类

页面分类器接收规范化 URL，只返回受支持的板块枚举或 `other`。板块与 URL 规则集中维护并有表驱动测试；禁止各 UI/content script 重复正则。必须覆盖 Bilibili SPA 的 `pushState`、`replaceState`、`popstate` 及站点自定义导航导致的 URL 变化。

未知路由采用安全降级：不屏蔽、可归入 `other` 的聚合时长，但不得记录完整 URL。站点 DOM 选择器失效时不得把整个网站永久隐藏；应显示可退出的扩展自有遮罩或停止增强，并记录本机可诊断状态。

## 权威计时模型

有效使用时间同时满足：

1. URL 属于 Bilibili 支持范围；
2. `document.visibilityState === "visible"`；
3. 页面/浏览器窗口处于有效焦点；
4. 没有浏览器休眠、页面冻结或超时心跳间隙。

content script 发出 `SESSION_START`、`HEARTBEAT`、`ROUTE_CHANGE`、`SESSION_STOP`。协调者用时间戳与会话随机 ID 去重；累计相邻心跳差值时设置合理上限，超过上限视为中断，避免睡眠后一次补入数小时。跨本地午夜时将区间切开再归桶；周/月汇总从每日桶派生，不能维护三份互相漂移的权威数据。

墙上时间用于日期展示和计划，单调时间用于单次活跃区间差值（平台可用时）。系统时钟回拨、时区变化和 DST 都不得生成负数或重复统计。

## 计划与临时放行

- 计划判定是纯函数：`schedule + localDateTime -> active/inactive + nextTransition`。
- 跨午夜计划按明确语义拆分或按起始日归属，并在 UI 中说明。
- 冲突计划采用“更严格规则生效”，除非存在用户显式创建且未过期的临时放行。
- 临时放行存储绝对过期时间和作用域，过期即失效；重启浏览器不能延长。
- `alarms` 仅用于唤醒和刷新，不作为真实时间来源；每次唤醒重新计算状态。

“观看计划模式”与普通板块屏蔽计划是两个独立策略层：

- 计划模式默认关闭；开启后，`document_start` 的 content script 在启动计时或渲染普通遮罩前先请求导航判定；
- 未携带有效授权的任意 `https://*.bilibili.com/*` 导航都会进入扩展自有 `plan.html`，且不把来源 URL、搜索词或用户标识附加给计划页；
- 用户只能从扩展计划页点击“开始观看”创建授权；授权精确绑定 `itemId + BVID + expiresAt`，不能放行同域其他页面或相关视频；
- 完成、删除、更换 BV 号、暂停计划模式或授权过期都会撤销授权；被计划模式阻断的时间不进入统计；
- 队列持久化只保存规范化 BV 号及其 canonical `https://www.bilibili.com/video/BV…` URL，不保存原始查询参数。

## 数据契约

首发逻辑键（以核心模块 `STORAGE_KEYS` 为唯一代码来源）：

- `bilifocus.settings.v1`
- `bilifocus.usage.v1`
- `bilifocus.temporary-access.v1`
- `bilifocus.plan-queue.v1`
- `bilifocus.plan-access.v1`

每个值包含 `schemaVersion`，读取时先验证再迁移。迁移必须幂等、保留可识别数据，并在失败时保留原值、回退到安全默认值；禁止静默覆盖损坏数据。正式类型以核心模块定义为准，变更时同步更新此文档和 fixtures。

数据最小化约束：统计只存本地日期、板块枚举和非负整数秒数。观看计划只在用户主动添加时保存 BV 号、canonical URL、标题、顺序、来源和完成状态。其余浏览过程不存完整 URL、标题、视频/用户 ID、账号、Cookie、搜索词或页面正文。

## 导入与账号连接边界

`src/integrations` 定义独立的 `BilibiliImportProvider` 端口，业务队列只接收最小化的 `{ bvid, title, url }`。当前实现包含：

- 完全本地的批量 URL/BVID 解析、去重、标题清洗和规模上限；不跟随短链、不抓取页面元数据；
- Bilibili 官方开放平台 provider 的 `not-configured` 安全占位，不发起请求、不读取 Cookie、不接收密码；
- 面向未来的 watch-later、favorite-folders、favorite-media 能力接口。

正式账号导入属于远程能力重大变更：必须使用官方文档端点与用户授权，在可信服务端交换令牌，客户端不得包含 secret；实现前须重新评审平台资质、scope、数据保留、撤销、网络失败与商店披露。未经书面许可不得以自动程序调用私有接口抓取账号数据。

## 消息边界

消息采用带版本的判别联合：`{ version, type, requestId, payload }`。接收端必须检查：

- `sender.id` 属于当前扩展；扩展页即使打开在普通标签页中也按受信 extension URL 识别，不能仅用 `sender.tab` 判断；来自 content script 时 URL host 必须属于 Bilibili；
- `type` 在白名单；payload 是普通 JSON，字段和值域有限；
- 时间、字符串长度、数组规模和枚举合法；
- 不接受要访问的任意 URL、脚本内容、CSS、方法名或任意 storage key。

响应不向 content script 返回全量历史、内部错误栈或其他标签页信息。

计划队列 CRUD 只接受扩展页发送者；content script 只能请求基于 BVID 的导航判定，不能读取清单或创建观看授权。

## 可访问性与 UI 稳定契约

原生控件优先；所有开关、输入和图表有可访问名称。键盘焦点可见，状态不只靠颜色表达，200% 缩放不丢功能。测试优先使用 role/label；只有无稳定语义的关键容器才使用 `data-testid`。

## 演进规则

新增板块、统计维度或浏览器时，先扩充 domain 枚举/端口与表驱动测试，再接入 UI 和 adapter。新增远程服务、同步、账户、遥测或任何权限属于架构与隐私重大变更，必须先通过 [QUALITY.md](./QUALITY.md) 的重新评审。
