# Hourleaf

Hourleaf 是一款本地优先、开源、跨浏览器的网站专注扩展。你可以只授权自己想管理的网站，为同一网站设置多个独立时间段、使用分组和到期模式，并在本机查看日 / 周 / 月使用时间。

> [!IMPORTANT]
> **免责声明与非盈利说明**：Hourleaf 仅供学习、研究和技术交流，作者以非盈利方式维护本项目。软件按现状提供，不保证计时、拦截、本地规则或第三方页面适配在所有环境中持续、准确或无误运行，也不能替代用户对重要安排、文件和数据的自行核验。使用者应自行检查并承担导入规则、CSS 或用户脚本的风险。
>
> 本项目与所支持网站及其权利人不存在隶属、授权或背书关系；相关名称、商标与内容权利归各自权利人所有。除非作者另行书面确认，任何个人或第三方基于本项目开展的销售、付费分发、代安装、广告、募资、商业服务或其他盈利活动，均属于该行为方的独立行为，与作者及维护者无关，也不得暗示作者授权、参与或背书。本段不限制 [MIT 许可证](./LICENSE)依法授予的权利，亦不排除或限制依法不能排除或限制的责任。
>
> 如果你认为本仓库的代码、文档或发布物侵犯了你的合法权益，请通过 [GitHub Issues](https://github.com/446F7269616E/Hourleaf/issues) 提供具体链接、权利依据和便于核实的信息；请勿公开提交身份证件、账号数据等敏感资料。维护者核实后会及时更正、移除或采取其他合理措施。未公开漏洞或其他安全敏感事项请按 [SECURITY.md](./SECURITY.md) 私密报告。

## 功能

- 添加任意 HTTP/HTTPS 网站，并只在确认后申请该网站的精确访问权限；
- 在配置页以时间段为主体；同一网站可拥有多个独立额度、一直可用或一直禁用的时间段，每个时间段独立启停并实时保存；
- 把一个时段额度平均分成多组，并用等待、数学题或本地密码开启下一组；
- 网站可选择宽容、心流或严格模式；结束访问后进入可自定义的独立结束页；
- 仅在页面可见、窗口聚焦且设备未空闲时计时；
- 可用时段优先于不可用时段，支持跨午夜和晨间、午间、晚间、饭点预设；
- 通过计划清单安排要访问的页面；每项有预定时长和到期模式，支持自适应列表及可拖拽、缩放、适配画布的思维导图视图；
- 在仪表盘查看今天、本周和本月的使用分布；
- 在浏览器快速访问入口查看当前网站今日已用时间和剩余时间；
- 所有设置、计划和聚合统计默认只保存在浏览器本地；
- 支持精确域名黑名单/白名单、元素隐藏与自包含 CSS；
- 从本地 `.json`、`.css`、`.user.js` 文件导入、启停或删除可选模块；
- Chromium / Firefox 用户脚本仅通过浏览器的隔离 User Scripts API 执行；
- 使用同一套界面和数据契约构建 Chromium、Firefox 与 Safari 版本。
- 界面支持简体中文、英文和跟随系统语言。

## 商店核心与本地模块

Hourleaf 商店包只提供通用、可解释的专注核心：计时、精确网站权限、域名策略、元素隐藏、CSS、模块导入器和平台允许的用户脚本隔离环境。商店包不内置 Bilibili 或其他网站的专用可执行模块。

GitHub 的 [Release 页面](https://github.com/446F7269616E/Hourleaf/releases/latest) 提供与扩展安装包分开的可选模块 ZIP，[可选模块目录](./optional-modules/) 保留可审查源码。Hourleaf 不会联网读取目录、检查模块更新或根据 URL 执行代码。用户需要先下载并阅读文件，再在“设置 → 模块设置”中手动选择本地文件、核对网站范围并授权。Bilibili 专注模块已从仓库历史适配恢复并按当前本地模块安全边界重写，但不会预装。

模块清单只接受精确 HTTP(S) 来源，并拒绝无法保持协议、主机与端口精确边界的 DNR 规则；CSS 禁止远程 `@import`；用户脚本不会通过 `eval`、`Function`、script 标签或通用 scripting API 执行。

平台边界：

- Chromium：使用官方 [User Scripts API](https://developer.chrome.com/docs/extensions/reference/api/userScripts)，用户还需在扩展详情中允许用户脚本；
- Firefox：使用官方 [MV3 User Scripts API](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/API/userScripts) 和可选权限；
- Safari App Store：根据 Apple [App Review Guidelines 2.5.2](https://developer.apple.com/app-store/review/guidelines/) 禁止导入/执行用户脚本，只保留 JSON、域名策略与自包含 CSS。

Chrome Web Store 的 MV3 远程代码要求明确把 User Scripts API 列为专用例外，但仍要求功能透明可审查，详见 [官方政策](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)。Firefox AMO 版本同时遵循其[扩展政策](https://extensionworkshop.com/documentation/publish/add-on-policies/)，不加载远程代码。

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
- `dist/packages`：商店候选 ZIP 与 `SHA256SUMS`；
- `optional-modules/`：源码仓库中的可选本地模块，不进入商店构建产物。

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

使用统计仅保存网站标识、日期和聚合秒数，不保存普通浏览的完整 URL、网页正文、搜索词或账号信息。计划清单只保存你主动添加的 URL、标题、顺序和完成状态。本地模块文件内容保存在扩展本地存储中，删除模块后移除。详情见 [PRIVACY.md](./PRIVACY.md)、[本地模块规范](./docs/LOCAL_MODULES.md) 与 [威胁模型](./docs/THREAT_MODEL.md)。

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
- [模块开发准则](./docs/MODULE_DEVELOPMENT.md)

欢迎提交 issue 和 pull request。请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [SECURITY.md](./SECURITY.md)。

## 许可证

[MIT](./LICENSE) © 2026 Hourleaf contributors
