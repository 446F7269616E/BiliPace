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
- 内置 Bilibili 站点模块，可随时启用、停用、删除或恢复；
- 使用同一套界面和数据契约构建 Chromium、Firefox 与 Safari 版本。

## 内置站点模块

Hourleaf 始终只安装一个扩展。通用计时、时间规则、计划、统计和界面与站点模块保持独立代码边界，所有经过审核的模块随同一个签名包预装，不从网络下载或执行代码。

Bilibili 模块提供板块统计、站内内容降噪和视频计划身份识别。模块初始不启用，也不会自动申请网站权限。删除模块会注销它的本地代码块并清理模块规则；后续页面不再加载该代码，用户也可以从内置模块列表恢复。未启用模块时，Bilibili 与其他网站一样使用通用整站规则。

### 兼容性

Bilibili 模块对 BewlyBewly! Ave Mujica 提供基础兼容；兼容层失效时会停止增强，不影响页面正常使用。

每个平台只生成一个 `hourleaf-<version>-<browser>.zip`。GitHub ZIP 是源码/开发者侧载产物；Chrome、Firefox 与 Safari 的正式安装仍分别以 Chrome Web Store、AMO 签名和 App Store 签名版本为准。

## 从源码运行

需要 Node.js 22 或更高版本。

```bash
npm ci
npm run build
npm run package
```

构建目录：

- `dist/chromium`、`dist/firefox`、`dist/safari`：完整扩展；
- 每个平台目录中的 `modules/`：只在对应模块启用时注册的本地代码块。

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
