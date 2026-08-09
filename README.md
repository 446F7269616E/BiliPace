# BiliPace（哔哩节拍）

一个本地优先、开源、跨浏览器的 Bilibili 专注扩展。支持内容降噪、时间规则、观看计划和日 / 周 / 月使用统计。

> BiliPace 是非官方项目，与哔哩哔哩、Google、Mozilla 或 Apple 无隶属、认可或合作关系。

## 最快启用（Chrome / Edge）

1. 从 [GitHub Releases](https://github.com/446F7269616E/BiliPace/releases/latest) 下载 `bilipace-*-chromium.zip` 并解压；
2. 打开 `chrome://extensions`（Edge 使用 `edge://extensions`）；
3. 打开右上角“开发者模式”，点击“加载已解压的扩展程序”，选择解压后的文件夹；
4. 在浏览器扩展菜单中固定 **BiliPace** 图标，然后点击图标即可启用或暂停“专注保护”。

## 功能

- 为不同 Bilibili 板块单独启用或停用专注规则；
- 按需隐藏首页推荐、动态流、相关视频、评论、搜索联想、推广与顶部导航；
- 按标题关键词或受限正则隐藏视频卡片，按 `/` 快速聚焦站内搜索；
- 开启 BewlyBewly! Ave Mujica 时，计时、专注拦截、计划模式和基础内容降噪仍可用；
- 为各板块创建按星期和时间范围生效的可用/不可用时段，白名单优先并支持跨午夜；
- 提供晨间、午间、晚间和饭点时间预设；
- 为各板块设置每日使用额度，达到额度后自动进入专注页；
- 可选“计划模式”：打开任意 Bilibili 链接时先进入观看清单，只在所选时长内打开从清单开始的对应 BV 视频；
- 以待办方式添加、编辑、完成或恢复计划视频，支持时间列表与可拖拽思维导图视图；
- 在自己设定的次数和时长内临时访问当前页面；
- 仅在页面可见、窗口聚焦且设备未空闲时累计使用时间，并实时显示当前是否计时；
- 在本机查看今日、本周和本月的板块分布与每日趋势；
- 通过左侧菜单在仪表盘、计划、配置和设置之间切换；
- 所有设置、观看清单与聚合统计只存于浏览器本地，无遥测、广告和云端传输；
- 同一源码构建 Chromium、Firefox 和 Safari Web Extension 产物。

## 从源码安装

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
  --app-name BiliPace \
  --bundle-identifier io.github.bilipace.BiliPace \
  --swift
```

在生成的 Xcode 工程中选择自己的开发 Team 和唯一 bundle identifier 后运行。真机、TestFlight 或 App Store 分发需要有效的 Apple Developer 身份与签名；仓库不会包含任何证书或 provisioning profile。

## 页面

| 页面   | 内容                                     |
| ------ | ---------------------------------------- |
| 仪表盘 | 实时计时、日 / 周 / 月统计和板块分布     |
| 计划   | 视频待办、批量添加、列表和思维导图视图   |
| 配置   | 内容降噪、板块限额、可用/不可用时间规则  |
| 设置   | 专注总开关、计划模式、临时访问和本地数据 |

## 隐私与权限

BiliPace 申请：

- `storage`：保存本地设置、临时放行和按日期 / 板块聚合的秒数；
- `idle`：设备处于空闲或锁定状态时停止计时；
- `https://*.bilibili.com/*`：仅在 Bilibili 页面分类、计时和显示专注页。

使用统计不会保存完整 URL、具体视频、搜索词或账号信息。仅当你主动把视频加入观看计划时，扩展才在本机保存规范化 BV 号、标题、清单顺序和完成状态；不会保存 Cookie、密码或页面正文，也不会将产品数据发送到任何服务器。详情见 [PRIVACY.md](./PRIVACY.md) 和 [docs/THREAT_MODEL.md](./docs/THREAT_MODEL.md)。

## 开发与验证

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

真实浏览器测试使用隔离 profile；完整检查项记录在 [手工验收](./docs/MANUAL_ACCEPTANCE.md)。

完整架构、质量门禁与跨浏览器验收见：

- [架构与数据契约](./docs/ARCHITECTURE.md)
- [质量与商店合规](./docs/QUALITY.md)
- [手工验收](./docs/MANUAL_ACCEPTANCE.md)
- [发布清单](./docs/RELEASE_CHECKLIST.md)
- [用户体验文案规范](./docs/UX_WRITING.md)

构建结果位于 `dist/chromium`、`dist/firefox` 和 `dist/safari`。生成的 Safari Xcode 工程、商店签名资料和 `dist` 不提交到 Git。

## 贡献与安全

欢迎提交 issue 和 pull request。开始前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。安全或隐私漏洞请按 [SECURITY.md](./SECURITY.md) 私密报告，不要在公开 issue 中披露可利用细节或个人数据。

## 许可证

[MIT](./LICENSE) © 2026 BiliPace contributors
