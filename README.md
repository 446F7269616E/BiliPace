# BiliFocus（哔哩专注）

一个本地优先、开源、跨浏览器的 Bilibili 专注扩展。你可以分别控制首页、动态、热门、视频、直播、番剧影视和搜索页面，在指定星期与时段屏蔽容易分心的板块，并通过日 / 周 / 月仪表盘了解时间去向。

> BiliFocus 是非官方项目，与哔哩哔哩、Google、Mozilla 或 Apple 无隶属、认可或合作关系。

## 功能

- 为不同 Bilibili 板块单独启用或停用专注规则；
- 创建多条按星期、开始时间和结束时间生效的计划，支持跨午夜；
- 为各板块设置每日使用额度，达到额度后自动进入专注页；
- 可选“计划模式”：打开任意 Bilibili 链接时先进入观看计划，只限时放行从清单中明确开始的对应 BV 视频；
- 以待办方式添加、编辑、排序、完成或恢复计划视频，并可在本机批量解析视频链接；
- 在受控次数和时长内临时放行，避免把专注工具变成无法退出的陷阱；
- 仅在页面可见、窗口聚焦且设备未空闲时累计使用时间；
- 在本机查看今日、本周和本月的板块分布与每日趋势；
- 所有设置、观看清单与聚合统计只存于浏览器本地，无遥测、广告和云端传输；
- 同一源码构建 Chromium、Firefox 和 Safari Web Extension 产物。

## 安装

### Chrome / Edge / 其他 Chromium 浏览器

1. 安装 [Node.js](https://nodejs.org/) 22 或更新版本；
2. 克隆仓库并运行：

   ```bash
   npm ci
   npm run build:chromium
   ```

3. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）；
4. 开启“开发者模式”，选择“加载已解压的扩展程序”；
5. 选择 `dist/chromium`。

### Firefox

```bash
npm ci
npm run build:firefox
```

打开 `about:debugging#/runtime/this-firefox`，选择“临时载入附加组件”，然后选择 `dist/firefox/manifest.json`。正式安装的 XPI 必须经 Mozilla AMO 签名。

### Safari（macOS / iOS / iPadOS）

需要 macOS 和当前 Xcode。先构建 Safari 输入目录，再生成承载 App：

```bash
npm ci
npm run build:safari
xcrun safari-web-extension-packager dist/safari \
  --app-name BiliFocus \
  --bundle-identifier com.example.BiliFocus \
  --swift
```

在生成的 Xcode 工程中选择自己的开发 Team 和唯一 bundle identifier 后运行。真机、TestFlight 或 App Store 分发需要有效的 Apple Developer 身份与签名；仓库不会包含任何证书或 provisioning profile。

## 使用

安装后点击工具栏中的 BiliFocus 图标：

1. 用总开关开始或暂停专注；
2. 在“专注设置”中选择要管理的板块、每日额度和详细计划；
3. 在“观看计划”中按需开启计划模式，添加视频并调整顺序；只有点击“开始观看”的对应视频会在设定窗口内放行；
4. 被普通板块规则拦截时可返回，或在允许次数内临时访问；
5. 打开“使用洞察”查看日 / 周 / 月统计，也可以清空所有本地统计。

首次使用建议先只启用首页、动态和热门，确认计划符合自己的作息后，再为视频或直播设置每日额度。

## 隐私与权限

BiliFocus 申请：

- `storage`：保存本地设置、临时放行和按日期 / 板块聚合的秒数；
- `idle`：设备处于空闲或锁定状态时停止计时；
- `https://*.bilibili.com/*`：仅在 Bilibili 页面分类、计时和显示专注页。

使用统计不会保存完整 URL、具体视频、搜索词或账号信息。仅当你主动把视频加入观看计划时，扩展才在本机保存规范化 BV 号、标题、清单顺序和完成状态；不会保存 Cookie、密码或页面正文，也不会将产品数据发送到任何服务器。详情见 [PRIVACY.md](./PRIVACY.md) 和 [docs/THREAT_MODEL.md](./docs/THREAT_MODEL.md)。

## Bilibili 账号导入状态

当前版本提供安全的本地批量粘贴入口，但不会读取网页登录状态、Cookie 或调用未公开接口。“稍后再看”和指定收藏夹的快速导入已经预留 provider 接口；真正启用前需要完成 [Bilibili 开放平台](https://openhome.bilibili.com/)的应用资质、用户授权和服务端令牌交换，并另行评审权限与隐私披露。扩展不会要求用户输入 Bilibili 密码，也不会在安装包中嵌入应用密钥。

## 开发与验证

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

真实浏览器测试会启动隔离的浏览器 profile；人工测试建议按 [手工验收](./docs/MANUAL_ACCEPTANCE.md) 操作，避免使用含私人数据的日常 profile。

完整架构、质量门禁与跨浏览器验收见：

- [架构与数据契约](./docs/ARCHITECTURE.md)
- [质量与商店合规](./docs/QUALITY.md)
- [手工验收](./docs/MANUAL_ACCEPTANCE.md)
- [发布清单](./docs/RELEASE_CHECKLIST.md)

构建结果位于 `dist/chromium`、`dist/firefox` 和 `dist/safari`。生成的 Safari Xcode 工程、商店签名资料和 `dist` 不提交到 Git。

## 贡献与安全

欢迎提交 issue 和 pull request。开始前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。安全或隐私漏洞请按 [SECURITY.md](./SECURITY.md) 私密报告，不要在公开 issue 中披露可利用细节或个人数据。

## 许可证

[MIT](./LICENSE) © 2026 BiliFocus contributors
