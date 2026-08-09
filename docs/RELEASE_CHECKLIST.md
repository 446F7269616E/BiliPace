# BiliPace 公开发布清单

## 1. 冻结候选

- [ ] 明确版本、commit SHA、变更日志和支持的最低浏览器版本。
- [ ] clean checkout 可用锁文件规定的命令重建三个 `dist` 产物；记录 SHA-256。
- [ ] 依赖、许可证、secret scan、漏洞扫描通过；仓库/产物无 `.env`、token、证书、profile、私钥或测试用户数据。
- [ ] 版本号在 package、各 manifest、商店元数据和 release tag 一致。
- [ ] `SECURITY.md`、`PRIVACY.md`、`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、许可证、README 与变更日志齐全。

## 2. 质量与安全门禁

- [ ] 单元、组件、E2E 与构建检查全绿；失败重跑不能代替根因处理。
- [ ] 完成 [QUALITY.md](./QUALITY.md) 的权限/远程代码/隐私门禁。
- [ ] 完成 [MANUAL_ACCEPTANCE.md](./MANUAL_ACCEPTANCE.md)，附浏览器版本、截图/trace 和测试人。
- [ ] 复测 Chrome 扩展页发送者识别：popup/options/dashboard/plan 在工具栏或普通标签页打开时均不会出现消息端口关闭或“暂时无法加载数据”。
- [ ] 完成 [THREAT_MODEL.md](./THREAT_MODEL.md) 复核；所有高风险项已缓解或由维护者书面接受。
- [ ] 从最终 zip/xpi/app 候选反向检查，而不是只检查源码目录。
- [ ] 验证升级迁移、降级不损坏、清空数据和卸载。

## 3. 商店公共素材

- [ ] 名称/副标题使用 BiliPace（哔哩节拍），显著注明非官方；不使用造成官方背书误解的图标、商标或截图。
- [ ] 描述只承诺已实现功能，清楚说明单一用途、权限理由、本地统计和支持渠道。
- [ ] 截图来自候选版本，不包含真实账号、头像、历史、消息或其他个人数据。
- [ ] 隐私政策使用稳定公开 HTTPS URL；商店数据披露与 `PRIVACY.md` 和实际产物一致。
- [ ] 提供版本化支持/安全报告入口；不在 issue 中收集敏感漏洞细节。

## 4. Chrome Web Store

- [ ] 打包 `dist/chromium`，zip 根目录直接包含 `manifest.json`。
- [ ] 手工审计 required/optional/host/content-script 权限及逐项理由；无未来预留权限。
- [ ] 审计所有 JS/Wasm/CSP/source map：无远程托管代码、动态执行、CDN 或生产调试泄漏。
- [ ] 确认 `content_scripts` 只覆盖 Bilibili HTTPS，`web_accessible_resources` 只暴露 `plan.html`，且计划授权不能放行非目标 BVID。
- [ ] Developer Dashboard 的 single purpose、permission justification、data usage、privacy policy 与截图填完。
- [ ] 上传后用商店草稿/测试发布安装候选，复测安装、升级与权限提示。
- [ ] 发布账号开启强 MFA，发布者组仅保留必要成员；保存审核提交记录。

## 5. Firefox AMO

- [ ] `dist/firefox/manifest.json` 含稳定 `browser_specific_settings.gecko.id` 和准确的 `data_collection_permissions`。
- [ ] `web-ext lint --source-dir dist/firefox` 通过；固定版本工具的输出归档。
- [ ] 构建过程可复现；按 AMO 要求附未混淆源代码、依赖获取和构建说明。
- [ ] 决定 AMO listed 或 self-distributed；两者都必须经 Mozilla 签名。
- [ ] 上传 AMO，处置验证/审核反馈；用最终签名 XPI 完成安装、升级、禁用与卸载测试。

## 6. Safari / App Store

- [ ] 选定唯一 bundle identifier、承载 app 名称与支持平台；开发者账号和协议有效。
- [ ] 用当前 Xcode 运行 `xcrun safari-web-extension-packager dist/safari`；转换日志与每条 warning 的决议归档。
- [ ] Xcode target、entitlements、网站权限和 Privacy 信息只包含必要能力；签名资料不进入 Git。
- [ ] macOS/iOS archive 使用正确 Team、证书和 provisioning；验证包内版本、图标、扩展资源。
- [ ] 通过 TestFlight 完成 macOS（如发布）和 iOS/iPadOS 真机验收。
- [ ] App Store Connect 隐私答案、产品页、支持 URL、隐私 URL 和审核备注与实际行为一致。
- [ ] 正式分发加入 Apple Developer Program。App Store 路径完成签名/归档/审核；macOS 站外路径完成 Developer ID 签名、公证与 Gatekeeper 验证。

## 7. GitHub 公开仓库

- [ ] 默认分支保护、必需 CI、review 与最小维护权限启用；Actions pin 到可信版本。
- [ ] 从全新 clone 按 README 构建/测试成功；源码与 tag/release artifact 对应。
- [ ] 创建签名/受保护 tag 和 GitHub Release，附变更、已知限制、校验和及三平台状态。
- [ ] 开启 GitHub Private Vulnerability Reporting（可用时），配置 issue/PR 模板与 Dependabot/等价更新流程。
- [ ] 公开发布前扫描完整 Git 历史；若曾提交密钥，仅删除文件不够，必须轮换密钥并清理历史。

## 8. 分阶段发布与回滚

- [ ] 优先小比例/受控测试发布，观察商店审核、崩溃反馈、错误计时和页面兼容问题。
- [ ] 指定发布负责人、回滚负责人、观察窗口和 stop criteria。
- [ ] 准备上一安全版本及数据向后兼容说明；回滚不得丢失或重复统计。
- [ ] P0：暂停/撤回发布，发布安全或故障公告；P1：冻结推广并在约定窗口修复。
- [ ] 发布后再次安装商店实际版本，核对版本、权限、网络、升级与公开校验和。
