# Hourleaf 公开发布清单

## 候选冻结

- [ ] 版本、commit、变更日志、最低浏览器版本与 manifest 一致。
- [ ] clean checkout 可复现核心版和模块 bundle；记录所有 ZIP 的 SHA-256。
- [ ] 仓库和产物无 token、证书、profile、私钥、测试账号或用户数据。
- [ ] README、隐私政策、安全政策、许可证和商店文案与候选行为一致。

## 质量与隐私

- [ ] 静态检查、单元/组件/E2E 和三平台候选验收全部完成。
- [ ] 核心包不含站点模块代码；模块包只含声明的主机和能力。
- [ ] 可选网站范围没有转化为默认全站访问；每次请求为精确 origin。
- [ ] 没有远程 JS/Wasm、动态执行、CDN、生产 source map 或复杂远程指令。
- [ ] 设置页的“获取”打开正常商店/Release 页面，不静默安装或误导。
- [ ] 升级迁移、权限拒绝/撤销、清空、删除网站、卸载和回滚已验证。
- [ ] `PRIVACY.md`、商店数据披露、Storage 和抓包结果一致。

## 公共素材

- [ ] 名称统一为 Hourleaf；站点模块清楚标注第三方非官方适配。
- [ ] 描述只承诺已实现功能，说明本地统计和按需网站权限。
- [ ] 截图来自候选版本，不含真实账号、头像、历史或其他个人数据。
- [ ] GitHub ZIP 标明源码/开发侧载；不宣称可绕过商店正常安装。

## 平台

### Chrome / Chromium

- [ ] 核心和 Bilibili bundle 的 ZIP 根目录直接包含 `manifest.json`。
- [ ] Developer Dashboard 的 single purpose、permission justification、data usage 与隐私 URL 填写完成。
- [ ] 商店草稿安装后复测权限提示、Service Worker 恢复与升级。

### Firefox

- [ ] manifest 保留稳定 Gecko ID 和准确 `data_collection_permissions`。
- [ ] `web-ext lint` 通过；构建说明和可审计源码按 AMO 要求提交。
- [ ] 使用最终 AMO 签名 XPI 验证安装、升级、禁用、启用和卸载。

### Safari

- [ ] 用当前 Xcode 转换 `dist/safari`，所有 warning 都有决议。
- [ ] entitlements、网站权限和隐私信息只包含必要能力；签名资料不进 Git。
- [ ] TestFlight/App Store 候选完成 macOS/iOS 权限拒绝、授权、撤销与升级。

## GitHub 与发布

- [ ] 默认分支保护、必需 CI、最小维护权限和私密漏洞报告启用。
- [ ] 创建受保护 tag 和 GitHub Release，上传核心版、模块 bundle、模块开发包、源码与 `SHA256SUMS`。
- [ ] Release 只记录产品变更、已知限制与平台状态，不包含内部协作说明或面向单个用户的建议。
- [ ] 小比例发布后观察错误计时、权限和站点兼容问题；保留上一安全版本和数据兼容路径。
