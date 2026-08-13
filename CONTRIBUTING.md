# Contributing to Hourleaf

感谢你帮助改进 Hourleaf。请先搜索已有 issue；较大的功能、权限或数据模型变更应先创建提案，避免在产品边界未达成共识前投入大量实现。

参与即表示你同意遵守 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。安全问题不要公开提交，请使用 [SECURITY.md](./SECURITY.md) 的私密渠道。

## 开发准备

需要当前 Node.js LTS、npm、Chrome/Chromium；Firefox 贡献建议安装 `web-ext`，Safari 贡献需要 macOS 与当前 Xcode。

```bash
npm ci
npx playwright install chromium firefox
npm run build
npm test
npm run test:e2e
```

以根 `package.json` 中实际脚本为准。不要绕过锁文件，不要提交 `dist`、测试 trace、浏览器 profile、签名证书、provisioning profile、`.env` 或任何 token。

## 设计原则

- 本地优先、单一用途、最小权限；不添加遥测、远程代码、广告或站外追踪。
- 领域逻辑与浏览器 API 解耦，新增平台差异放入 adapter/build 层。
- 可复用逻辑模块化；对 URL/时间/storage/message 等外部输入做运行时验证。
- UI 使用语义 HTML、可见焦点和明确 label；不得只用颜色表达状态。
- 所有用户可见文案必须通过 [UX writing 规范](./docs/UX_WRITING.md)；隐私行为、权限和数据 schema 变更同步更新文档。
- 可选网站模块遵守 [模块开发准则](./docs/MODULE_DEVELOPMENT.md) 和 [本地模块协议](./docs/LOCAL_MODULES.md)，不得预装、联网更新或扩大清单声明的来源权限。

## 提交变更

1. 从最新默认分支创建范围单一的分支。
2. 先添加/更新测试，再实现变更；时间逻辑必须覆盖边界与 fake clock。
3. 运行格式化、类型检查、单元测试、构建和相关 E2E。
4. 按 [MANUAL_ACCEPTANCE.md](./docs/MANUAL_ACCEPTANCE.md) 验证受影响浏览器。
5. PR 描述说明动机、行为变化、测试证据、浏览器差异、权限/隐私影响和截图（UI 变更）。

请保持 commit 可审阅，避免把无关格式化、生成文件或依赖升级混在功能提交中。PR 可能需要变更请求；请解决 review 对话而不是只将其标记为 resolved。

## 特殊变更门禁

以下变更在实现前必须获得维护者同意并更新 `docs/QUALITY.md`、`docs/THREAT_MODEL.md` 与 `PRIVACY.md`：新权限/站点、账户或同步、任何网络服务/遥测/第三方 SDK、数据导入导出、存储 schema 破坏性迁移、远程配置、商店身份或签名流程。

## Bug 与功能报告

提供版本、浏览器/系统、期望/实际结果和最小复现。截图与日志必须移除账号、头像、URL 参数、浏览历史和其他个人数据。功能提案应说明如何服务“按用户规则管理网站使用时间并减少分心内容”的单一用途。

## 许可证

提交代码即表示你有权贡献该内容，并同意按仓库根目录所声明的开源许可证分发。不要提交与项目许可证不兼容的素材或代码；第三方代码必须保留出处和许可证信息。
