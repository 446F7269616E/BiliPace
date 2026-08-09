# Hourleaf 质量与商店合规基线

> 状态：发布门禁
> 最近核对：2026-08-09

## 单一用途

Hourleaf 的单一用途是：帮助用户按自己的规则管理网站使用时间并减少分心内容。

- 计时、时段、额度、计划、统计和站点适配必须服务于该用途；
- 不注入广告，不出售数据，不将浏览活动用于画像或无关分析；
- 不把模块获取伪装成普通功能开关，不静默安装其他扩展；
- 商店说明、权限理由、隐私政策和实际行为必须一致。

## 权限预算

| 能力             | 权限                        | 约束                                                                  |
| ---------------- | --------------------------- | --------------------------------------------------------------------- |
| 本地设置与统计   | `storage`                   | 不使用云同步或遥测                                                    |
| 排除设备离开时间 | `idle`（平台支持时）        | 只判断 active/idle/locked                                             |
| 注册已授权网站   | `scripting`                 | 只注册到配置中且仍获授权的精确来源                                    |
| 用户选择的网站   | `optional_host_permissions` | `http://*/*`/`https://*/*` 只是请求上限；每次只申请精确 `${origin}/*` |

默认禁止 `tabs`、`history`、`cookies`、`identity`、`webRequest`、`downloads`、`management`、`nativeMessaging`、`debugger` 与 `unlimitedStorage`。新增权限必须有已实现功能、产品内说明和三平台兼容评审，不能只为未来预留。

动态 content script 只能匹配用户已启用且仍持有权限的网站。用户拒绝或撤销权限后，扩展必须安全停用该网站，不能循环弹窗或扩大请求范围。

## 模块与远程代码

- 扩展不得执行从 GitHub/CDN 下载的普通 JavaScript、WebAssembly、`eval`、`new Function` 或远程动态 import；
- 模块目录只允许版本、链接、权限和校验值等元数据，不能成为远程指令解释器；
- Chrome 设置页不能内联安装另一扩展，只能打开正常的 Chrome Web Store 详情页；
- Firefox 正式安装必须使用 AMO 签名包；
- Safari 模块必须随签名 App/扩展一同接受审核，设置页不能下载并执行新代码；
- GitHub ZIP 只标为源码或开发侧载产物；
- 核心版构建不得静态导入 Bilibili/Ave 代码，模块 bundle 只能包含仓库中可审计的本地代码。

参考官方边界：[Chrome MV3 远程代码](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)、[Chrome 分发](https://developer.chrome.com/docs/extensions/how-to/distribute)、[Firefox 签名](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)、[Safari 分发](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension)。

## 数据最小化

- 普通计时只保存用户配置的网站/目标 ID、日期和聚合秒数；
- 网站设置只保存精确 origin、hostname、用户标签和规则；
- 不持久化普通浏览的完整 URL、页面标题、搜索词、网页正文、Cookie 或账号；
- 计划只保存用户主动添加的 URL、标题、顺序、状态和限时授权；
- 模块可以在内存中分类页面或匹配元素，但不得把命中内容写入历史；
- 清空统计、删除网站和恢复设置必须立即清理对应本地数据；
- 不包含遥测、广告、账户、云备份或第三方分析。

## 跨浏览器产物

| 平台     | 核心目录        | 公开安装要求                                           |
| -------- | --------------- | ------------------------------------------------------ |
| Chromium | `dist/chromium` | Chrome Web Store 审核；开发版可加载已解压目录          |
| Firefox  | `dist/firefox`  | 固定 Gecko ID、AMO 签名、准确的数据声明                |
| Safari   | `dist/safari`   | Xcode 承载 App、Developer ID/App Store 签名与公证/审核 |

模块 bundle 位于 `dist/bundles/<module>/<platform>`。三平台共用业务与 UI；平台 manifest 只保留实际支持的权限/API。Safari 不支持的 API 必须显式降级，不能让扩展页闪退。

## 静态与手工门禁

- [ ] TypeScript、ESLint、Prettier 与三平台构建通过；
- [ ] manifest 只有预算内权限，CSP 无远程执行源；
- [ ] 核心 bundle 搜索不到 Bilibili/Ave 选择器、域名或导入；
- [ ] 只有用户点击添加网站时出现精确权限请求；拒绝/撤销可恢复；
- [ ] 可见、焦点、idle、休眠、跨午夜和 SPA 路由不会重复或虚增计时；
- [ ] allow/block 优先级、每日额度、临时访问与预设符合领域规则；
- [ ] 核心版与 Bilibili bundle 均可加载，模块停用后表现与通用网站一致；
- [ ] Ave ShadowRoot 选择器失效时安全放行，不隐藏整个未知页面；
- [ ] 固定左侧导航、键盘操作、200% 缩放与读屏名称可用；
- [ ] 隐私政策、商店数据披露与抓包结果一致；
- [ ] 公共仓库与产物不含密钥、证书、profile、账号或用户测试数据。

完整步骤见 [MANUAL_ACCEPTANCE.md](./MANUAL_ACCEPTANCE.md) 与 [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md)。
