# BiliPace 质量与商店合规基线

> 状态：发布门禁（normative）
> 最近核对：2026-08-06
> 产品名：BiliPace（哔哩节拍），非哔哩哔哩官方产品

本文记录 Chrome、Firefox 与 Safari 的质量边界。具体架构、手工验收、发布步骤和威胁模型分别见 [ARCHITECTURE.md](./ARCHITECTURE.md)、[MANUAL_ACCEPTANCE.md](./MANUAL_ACCEPTANCE.md)、[RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) 与 [THREAT_MODEL.md](./THREAT_MODEL.md)。这里的“必须”是公开发布门禁，不是建议。

## 1. 单一用途与用户承诺

BiliPace 的单一用途是：**帮助用户在哔哩哔哩站内按自己设定的规则减少分心，并在本机查看使用时间统计。**

- 屏蔽、计划、临时放行和统计都必须服务于这一用途。
- 不注入广告，不替换搜索，不追踪站外浏览，不抓取视频、评论、账号、Cookie 或个人资料。
- 不宣称与哔哩哔哩、Google、Mozilla 或 Apple 存在隶属、认可或合作关系。
- 商店描述、首次引导、权限理由、隐私政策与实际行为必须一致。

## 2. Chrome MV3 权限预算

Chrome Web Store 的“最小权限”是要求：无论必选还是可选权限，都只能申请当前功能所需的最窄范围；不能为未来功能预留权限。Chrome 也建议可行时使用运行时可选权限。BiliPace 的发布预算如下：

| 能力                         | 允许的最小权限/范围                                 | 理由与限制                                                |
| ---------------------------- | --------------------------------------------------- | --------------------------------------------------------- |
| 保存设置与本地统计           | `storage`                                           | 仅保存本文档列出的产品数据；首发不使用 `storage.sync`     |
| 在 Bilibili 页面计时与屏蔽   | `content_scripts.matches: https://*.bilibili.com/*` | 计划模式需要拦截任意 Bilibili 子域；不得使用 `<all_urls>` |
| 从站内进入扩展计划页         | 只暴露 `plan.html` 的 `web_accessible_resources`    | `matches` 仍限 `https://*.bilibili.com/*`，不得暴露 JS    |
| 到点刷新计划状态             | `alarms`（仅实现确实使用时）                        | Service Worker 会休眠，定时逻辑不得依赖常驻计时器         |
| 排除整机离开/锁定时间        | `idle`（仅实现确实使用时）                          | 只消费 active/idle/locked 状态，不推断或保存额外设备活动  |
| 主动提醒                     | `notifications`（优先可选，且仅实现确实使用时）     | 用户未开启提醒时不应要求该权限                            |
| 用户点击扩展后临时操作当前页 | `activeTab`（仅实现确实使用时）                     | 不可与宽泛 `tabs` 权限并存而无逐项理由                    |

默认禁止：`<all_urls>`、`tabs`、`history`、`webRequest`、`webRequestBlocking`、`cookies`、`identity`、`downloads`、`management`、`nativeMessaging`、`debugger`、`unlimitedStorage`。基础 `tabs.query/onActivated/onUpdated` 事件本身不构成申请 `tabs` 权限的理由；若将来确需读取 host permission 未覆盖标签页的敏感 `url/title/favIconUrl` 等数据，必须先更新单一用途分析、权限说明、隐私政策、威胁模型和测试，再由维护者批准。

构建产物还必须满足：

1. `manifest_version` 为 `3`；只包含当前代码实际使用的权限。
2. 扩展逻辑全部打包在扩展内；不得加载 CDN JavaScript/Wasm、远程脚本、`eval` 或 `new Function`。
3. 扩展页 CSP 至少保持 `script-src 'self'; object-src 'self'` 的等价限制；不得放宽为远程代码执行源。
4. `web_accessible_resources` 只允许暴露计划模式重定向所需的 `plan.html`，`matches` 限到 `https://*.bilibili.com/*`；JS、source map 和内部数据文件不得暴露。
5. 所有 content-script 消息均视为不可信；Service Worker 对消息类型、发送方、字段、长度、枚举和值域做验证，不接受任意 URL 或任意 Chrome API 参数。
6. 仅使用 HTTPS host pattern；不得为兼容旧链接申请 `http://`。

## 3. Chrome Web Store 隐私与审核

使用时长、访问的 Bilibili 板块和页面活动属于浏览/网站活动数据。即使只在设备本地处理和保存，也必须如实披露。首发质量基线是：

- 数据仅保存在用户浏览器本机，不发送到开发者或第三方服务器；不做遥测、崩溃上报、账户或云同步。
- 使用统计只记录板块、日期和聚合秒数；只有用户主动加入观看计划时才保存规范化 BV 号/canonical URL、标题、队列和完成状态。不得从普通浏览自动生成观看历史，不保存搜索词、UP 主、账号信息、Cookie 或页面内容。
- 批量导入必须在本地解析且不跟随短链/抓取元数据；账号导入未取得官方资质、明确授权和服务端令牌边界前保持不可用，不得用私有 API 或网页登录 Cookie 代替。
- 用户可在产品内清空统计并恢复默认设置；卸载后由浏览器删除扩展本地数据。
- Chrome Web Store 的 Privacy practices、商店描述和仓库 `PRIVACY.md` 必须逐项一致。若实际实现偏离，发布必须阻断。
- 若未来收集或传输任何用户数据，必须在开始处理前提供产品内显著披露和明确同意；仅把说明放在隐私政策或商店页面不够。
- 不出售数据，不用于个性化/重定向/兴趣广告，不允许人工读取用户数据；任何新第三方处理方都要先更新披露并重新取得必要同意。

## 4. 跨浏览器发布策略

共享业务代码应依赖一个轻量 WebExtension 适配层，不在业务模块中散布 `chrome.*`/`browser.*` 分支。产物约定：

- Chrome/Chromium：`dist/chromium`
- Firefox：`dist/firefox`
- Safari 转换输入：`dist/safari`

### Firefox MV3

- Firefox MV3 发布 manifest 必须提供 `browser_specific_settings.gecko.id`；ID 一旦发布不得随意变化。
- Firefox 当前不支持 `background.service_worker`，MV3 使用非持久 `background.scripts` 事件页；跨浏览器产物必须按平台生成正确 background manifest，业务逻辑不能依赖 DOM 或常驻内存。
- 2025-11-03 起提交到 AMO 的新扩展须在 `browser_specific_settings.gecko.data_collection_permissions` 准确声明外部收集/传输类别；本项目若保持完全本地处理，应声明 `required: ["none"]`，并在提交前用当时的 AMO 文档复核。
- Release/Beta Firefox 安装的扩展必须由 Mozilla 经 AMO 签名；公开 AMO 与自分发 XPI 都受 Mozilla 政策和审核约束。
- 若构建含打包、压缩或代码生成，AMO 审核必须能够复现构建，并按要求提供源代码包。
- 先运行 `web-ext lint --source-dir dist/firefox`，再做临时加载与 AMO 验证。不得把“能在 Chromium 运行”视为 Firefox 验收。

### Safari Web Extension

- Safari 15.4+ 支持 MV3，但 manifest/API 并非与 Chromium 完全相同；转换器报告的每一条不支持警告都必须归档并处理。
- 在 macOS + 当前 Xcode 上使用 `xcrun safari-web-extension-packager dist/safari`（旧工具名为 `safari-web-extension-converter`）生成承载 app/Xcode 工程；生成工程不是跨平台源码的主来源，不手工复制业务逻辑形成分叉。
- Safari 支持 `chrome.*` 与 `browser.*`，但 `storage.sync` 不执行同步，`storage.session` 需要 Safari 16.4+，`update_url` 不受支持；不得依赖这些差异破坏核心功能。
- Safari 会单独向用户请求网站访问。只申请必要 Bilibili 域，验证“拒绝/仅一天/始终允许”后的降级与恢复体验。
- macOS 可临时加载未签名扩展进行开发测试；iOS 真机、外部测试和正式分发需要 Xcode/App Store 流程与签名。公开分发须加入 Apple Developer Program；App Store 分发需签署、归档和审核，macOS 站外分发则需 Developer ID 签名与公证。

## 5. 跨浏览器验收矩阵

| 门禁                         | Chromium                   | Firefox                                                       | Safari macOS              | Safari iOS/iPadOS                |
| ---------------------------- | -------------------------- | ------------------------------------------------------------- | ------------------------- | -------------------------------- |
| manifest/权限静态检查        | 必须                       | 必须 + `web-ext lint`                                         | 必须处理 packager 警告    | 同 macOS，并检查 iOS 限制        |
| 扩展真实加载冒烟             | Playwright 持久上下文      | `web-ext run`/签名候选手工；UI 契约由 Playwright Firefox 覆盖 | 临时扩展或 Xcode Debug    | Simulator + 至少一台真机候选构建 |
| 首页、动态、视频 SPA 导航    | 必须                       | 必须                                                          | 必须                      | 必须                             |
| 计划、临时放行、跨午夜/DST   | 自动 + 手工                | 自动 + 手工                                                   | 手工                      | 手工                             |
| 日/周/月仪表盘与清空数据     | 必须                       | 必须                                                          | 必须                      | 必须                             |
| 网站权限拒绝/撤销            | n/a 或 Chrome 站点访问设置 | 必须                                                          | 必须                      | 必须                             |
| 键盘、缩放、对比度、读屏语义 | 必须                       | 必须                                                          | VoiceOver 必须            | VoiceOver + 动态字体检查         |
| 商店安装/升级/卸载           | CWS 候选                   | AMO 签名候选                                                  | TestFlight/App Store 候选 | TestFlight/App Store 候选        |

Playwright 的 Firefox 项目用于验证 popup/options/dashboard/plan 的共享 Web UI 与纯业务契约；Playwright 本身不能替代 Firefox 的 AMO 签名扩展安装流程。真实 Firefox 集成使用 `web-ext` 启动候选产物并执行 [MANUAL_ACCEPTANCE.md](./MANUAL_ACCEPTANCE.md) 的同一组案例。Safari 目前作为签名候选手工门禁。

## 6. 自动化测试层次与命令约定

| 层                    | 目标                                          | 发布门禁                              |
| --------------------- | --------------------------------------------- | ------------------------------------- |
| 单元                  | 路由分类、计划判定、统计归桶、schema 迁移     | 边界分支全覆盖；时间逻辑用 fake clock |
| 组件/契约             | 三个扩展页、可访问名称、storage adapter       | Chromium + Firefox Web UI 项目通过    |
| Chromium 真实扩展 E2E | MV3 Service Worker、页面加载、导航、持久化    | `tests/e2e/extension.spec.ts` 通过    |
| 静态产物审计          | manifest 权限、CSP、远程代码、source map/密钥 | 三个产物均通过                        |
| 平台候选验收          | AMO、Safari 权限/签名/升级                    | 清单有版本化证据                      |

测试实现位于 `tests/e2e/`。预期命令由根 `package.json` 提供：`npm run build`、`npm run test`、`npm run test:e2e`。首次运行先执行 `npx playwright install chromium firefox`；真实扩展项目必须使用 Playwright bundled Chromium，因为新版 branded Chrome 不再支持 E2E 依赖的命令行侧载参数。测试失败时保留 trace、截图与控制台错误，不提交运行产物。

## 7. 不可妥协的发布门禁

- [ ] Chrome 产物没有超出第 2 节预算的权限，且没有远程可执行代码。
- [ ] 统计只在 Bilibili 标签页可见且窗口有效聚焦时累计；休眠、崩溃或关机不能产生大段虚假时长。
- [ ] SPA 导航后分类、屏蔽与计时能切换，且没有重复计时器/重复遮罩。
- [ ] 屏蔽计划、临时放行、跨午夜、时区/DST 与系统时钟变化已验收。
- [ ] 计划模式只放行从计划页启动的精确 BVID；其他子域、SPA 跳转、相关视频、过期/完成/删除后都会回到计划页。
- [ ] 批量导入无网络请求；官方账号导入明确不可用且不读取 Cookie、密码或私有 API。
- [ ] 清空数据立即作用于 storage 与所有打开的扩展页；无隐蔽副本。
- [ ] Firefox manifest 含稳定 ID 与准确数据声明，`web-ext lint` 通过，签名候选已验证。
- [ ] Safari packager 零未处置警告；macOS 与 iOS 权限拒绝、授权、撤销均通过。
- [ ] `PRIVACY.md`、商店数据披露和实际网络行为一致；抓包确认没有非 Bilibili/商店更新流量。
- [ ] 公共仓库不含密钥、签名证书、Apple provisioning profile、AMO/CWS API 凭据或用户测试数据。

## 8. 官方资料

以下资料均为平台官方文档，最后核对于 2026-08-06：

- Chrome：[Declare permissions](https://developer.chrome.com/docs/extensions/mv3/declare_permissions)、[Stay secure](https://developer.chrome.com/docs/extensions/mv3/security)、[Manifest V3 / no remotely hosted code](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)、[Improve extension security](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security)
- Chrome Web Store：[Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies)、[User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)、[Disclosure Requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)
- Mozilla：[browser_specific_settings](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)、[MV3 background compatibility](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)、[Signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)、[Add-on Policies](https://extensionworkshop.com/documentation/publish/add-on-policies/)、[Extensions and the add-on ID](https://extensionworkshop.com/documentation/develop/extensions-and-the-add-on-id/)
- Apple：[Packaging a web extension for Safari](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)、[Assessing browser compatibility](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility)、[Managing permissions](https://developer.apple.com/documentation/safariservices/managing-safari-web-extension-permissions)、[Distributing your Safari web extension](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension)、[Running your Safari web extension](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)
