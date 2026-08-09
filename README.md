# Hourleaf

Hourleaf 是一款本地优先、开源、跨浏览器的网站专注扩展。你可以只授权自己想管理的网站，为它们设置每日额度、可用或不可用时段，并在本机查看日 / 周 / 月使用时间。

## 功能

- 添加任意 HTTP/HTTPS 网站，并只在确认后申请该网站的精确访问权限；
- 仅在页面可见、窗口聚焦且设备未空闲时计时；
- 按网站设置每日额度、星期与小时范围；
- 可用时段优先于不可用时段，支持跨午夜和晨间、午间、晚间、饭点预设；
- 通过计划清单安排要访问的页面，支持列表和可拖拽的思维导图视图；
- 在仪表盘查看今天、本周和本月的使用分布；
- 所有设置、计划和聚合统计默认只保存在浏览器本地；
- Bilibili 与 BewlyBewly! Ave Mujica 适配作为可选站点模块提供；
- 使用同一套界面和数据契约构建 Chromium、Firefox 与 Safari 版本。

## 核心与站点模块

Hourleaf 核心只包含通用计时、时间规则、计划、统计和界面，不包含特定网站的 DOM 选择器或账号接口。站点模块可增加板块识别和内容降噪，但不能读取 Cookie、密码或任意扩展存储。

首个模块是 `hourleaf.site.bilibili`，覆盖 Bilibili 原生界面与 BewlyBewly! Ave Mujica 的基础兼容。它提供板块统计、站内内容降噪和视频计划身份识别。未启用模块时，Bilibili 与其他网站一样使用通用整站规则。

浏览器商店版本不会从 GitHub 下载普通 JavaScript 或 WebAssembly 后执行。发布包采用两种经过审核的构建：

- `hourleaf-<version>-<browser>.zip`：轻量核心；
- `hourleaf-bilibili-<version>-<browser>.zip`：包含已审核 Bilibili 模块的完整构建，模块仍需用户主动启用并授权站点。

设置页中的“获取”只会打开对应的正式商店或 GitHub Release 页面，不会静默安装代码。GitHub ZIP 是源码/开发者侧载产物；Chrome、Firefox 与 Safari 的正式安装仍分别以 Chrome Web Store、AMO 签名和 App Store 签名版本为准。

## 从源码运行

需要 Node.js 22 或更高版本。

```bash
npm ci
npm run build
npm run package
```

构建目录：

- `dist/chromium`、`dist/firefox`、`dist/safari`：核心版；
- `dist/bundles/bilibili/<browser>`：含 Bilibili 模块的构建；
- `dist/modules/bilibili`：站点模块描述、校验信息与开发包。

Chromium 可在 `chrome://extensions` 打开开发者模式后加载 `dist/chromium`。Firefox 可在 `about:debugging#/runtime/this-firefox` 临时载入 `dist/firefox/manifest.json`。

Safari 需要 macOS 和当前 Xcode：

```bash
xcrun safari-web-extension-packager dist/safari \
  --app-name Hourleaf \
  --bundle-identifier io.github.hourleaf.Hourleaf \
  --swift
```

真机、TestFlight 或 App Store 分发需要有效的 Apple Developer 身份与签名。

## 隐私与权限

Hourleaf 的必需权限用于本地存储、空闲状态判断和注册已授权网站的内容脚本。`http://*/*` 与 `https://*/*` 只声明为可选范围；添加网站时只申请该网站的精确来源，不会默认读取所有网站。

使用统计仅保存网站标识、日期和聚合秒数，不保存普通浏览的完整 URL、网页正文、搜索词或账号信息。计划清单只保存你主动添加的 URL、标题、顺序和完成状态。详情见 [PRIVACY.md](./PRIVACY.md) 与 [威胁模型](./docs/THREAT_MODEL.md)。

## 开发规范

```bash
npm run typecheck
npm run lint
npm run format:check
npm run build
```

架构、质量门禁与验收范围：

- [架构与数据契约](./docs/ARCHITECTURE.md)
- [质量与商店合规](./docs/QUALITY.md)
- [手工验收](./docs/MANUAL_ACCEPTANCE.md)
- [发布清单](./docs/RELEASE_CHECKLIST.md)
- [界面文案规范](./docs/UX_WRITING.md)

欢迎提交 issue 和 pull request。请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [SECURITY.md](./SECURITY.md)。

## 许可证

[MIT](./LICENSE) © 2026 Hourleaf contributors
