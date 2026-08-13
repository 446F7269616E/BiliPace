# Hourleaf 模块开发准则

本准则面向希望在 GitHub 提交或发布可选网站模块的开发者。模块是用户主动下载、审查和导入的本地文件，不是 Hourleaf 核心的一部分，不会被预装、远程拉取或自动更新。

协议字段的完整定义与平台限制见 [LOCAL_MODULES.md](./LOCAL_MODULES.md)。这里重点说明如何把模块做得安全、克制、可维护。

## 1. 先判断是否需要模块

只有网站特有的能力才应进入模块：

- 隐藏该网站独有的推荐流、推广、评论或导航元素；
- 为精确来源声明默认的 `timed`、`always-allow` 或 `always-block` 策略；
- 用少量本地 CSS 降低视觉干扰；
- 用无网络、无扩展权限的用户脚本提供轻量键盘操作。

计时、时间段、计划、访问确认、结束页和统计属于通用核心。模块不得复制这些功能，也不得读取或修改 Hourleaf storage。

## 2. 目录与文件

每个仓库模块使用独立目录：

```text
optional-modules/<slug>/
├── hourleaf-module.json
├── focus.css          # 可选
└── focus.user.js      # 可选
```

- `<slug>` 只用小写字母、数字和连字符，并在后续版本保持稳定。
- JSON 清单必须显式引用 CSS 与脚本；不允许未声明文件、子目录或远程文件。
- `id` 一经发布不得复用给另一个模块；建议使用反向域名或 `hourleaf.local.<site>-<purpose>`。
- 清单、CSS 和用户脚本元数据中的 `format`、`id`、`name`、`author`、`version` 必须一致。

最小清单：

```json
{
  "schemaVersion": 1,
  "format": "hourleaf.local-module",
  "id": "example.author.example-focus",
  "name": "Example Focus",
  "author": "Example Author",
  "version": "1.0.0",
  "description": "隐藏 Example 网站中的推荐与推广区域。",
  "matches": ["https://example.com/*"],
  "domainPolicy": "timed",
  "hideSelectors": [".recommendations", ".sponsored-card"],
  "cssFiles": ["focus.css"],
  "userScriptFiles": []
}
```

## 3. 来源和权限边界

- `matches` 只接受明确的 `http://host/*` 或 `https://host/*`，不接受通配主机、凭据、路径级权限幻想或非 Web 协议。
- 只声明实际测试过的来源。`www.example.com`、`live.example.com` 和 `example.com` 是三个不同来源，需要分别列出。
- 模块不能申请权限。Hourleaf 只会在导入预览后，由用户点击请求清单里的精确来源。
- 不得通过重定向、iframe、DNR、开放代理或脚本导航把权限扩大到未声明来源。
- 模块不得读取登录状态、Cookie、账号标识、页面正文或浏览历史并发送到外部。

## 4. 选择器与 CSS

选择器应描述稳定语义，而不是依赖脆弱的自动生成类名。

推荐顺序：

1. 稳定 ID、ARIA/role 或网站公开的语义类；
2. 组件根节点和明确的数据属性；
3. 经过两个以上页面形态验证的组合选择器。

避免：

- `body *`、通配后代链或大范围 `:has()`；
- 用 `!important` 重置整站字体、颜色或布局；
- 隐藏播放、暂停、字幕、登录、隐私或无障碍关键控件；
- 依赖单一账号、实验分组或语言环境才存在的选择器；
- `@import`、`url()`、远程字体、图片、追踪像素和任何网络资源。

`hideSelectors` 由核心生成隐藏规则。`focus.css` 只承担无法用隐藏表达的轻量视觉调整，并必须支持深浅色、200% 缩放和 `prefers-reduced-motion`。

## 5. 用户脚本

优先不用脚本。能用清单或 CSS 完成的功能，不应升级为脚本。

确需脚本时：

- 只监听必要事件，尽早返回；高频事件必须节流；
- 不轮询页面，不扫描整棵 DOM，不在每次 mutation 中做全页查询；
- 不阻止网站的主要快捷键，输入框和 `contenteditable` 获得焦点时必须退出；
- 对找不到节点、Shadow DOM 未挂载和 SPA 路由切换做安全降级；
- 不使用 `eval`、`Function`、字符串计时器、动态 import、WebAssembly 代码生成；
- 不使用 `fetch`、XHR、WebSocket、EventSource、Beacon 或其他外联；
- 不访问 `chrome.*`、`browser.*`、Cookie、扩展消息或注入 `<script>`；
- 不假设能在 Safari 执行。Safari Release 只支持不含用户脚本的模块。

静态检测是快速拒绝明显越界功能的防线，不是安全认证。评审者仍需逐行审查脚本的输入、输出、事件生命周期和最坏性能。

## 6. 性能预算

协议硬上限不是建议目标。仓库模块应尽量满足：

- 清单和选择器保持在实际所需范围；
- CSS 通常小于 20 KB；
- 用户脚本通常小于 30 KB；
- 页面初始化不做同步大循环；
- 单次交互只查询局部节点；
- 没有后台网络、遥测、广告或更新检查；
- 禁用模块后不再产生脚本、样式或权限副作用。

若需要突破这些软预算，PR 必须解释原因并提供可复现的性能证据。

## 7. 文案、可访问性与兼容性

- 名称描述功能，不暗示网站官方授权；第三方适配需明确“非官方”。
- `description` 说明模块做什么，不写营销承诺或无法验证的兼容范围。
- 新增快捷键时避开浏览器与网站常用快捷键，并提供输入状态保护。
- 不以颜色作为唯一状态，不移除焦点轮廓，不破坏键盘导航。
- 至少验证 Chromium 与 Firefox；包含脚本时在文档中标注 Safari 不支持该能力。
- 网站改版导致部分选择器失效时应安全地“什么都不做”，不能误隐藏主要内容。

## 8. 本地验证

1. 在设置页一次选择清单及全部引用文件，检查预览中的名称、作者、版本、来源和能力。
2. 分别验证授权拒绝、授权成功、启用、停用、删除和重新导入。
3. 检查模块声明的每个来源，以及未声明来源不会生效。
4. 在无登录、已登录、窄屏、200% 缩放、深浅色和减少动态环境下检查主要页面。
5. 运行：

```bash
npm run typecheck
npm run lint
npm run test -- tests/unit/local-modules.test.ts
npm run package
unzip -l dist/modules/hourleaf-module-<slug>-<version>.zip
```

仓库模块必须增加导入测试，直接读取目录中的真实文件并调用 `parseLocalModuleFiles()`，避免示例和运行契约漂移。

## 9. 版本与发布

模块使用语义化版本：

- patch：选择器修正、文案或兼容性修复；
- minor：新增来源、过滤区域或可选能力；
- major：行为或权限范围发生不兼容变化。

每次修改同步更新清单、CSS/脚本元数据和 Release 说明。`npm run package` 会为 `optional-modules/` 下的每个有效目录生成独立 ZIP 与 `MODULE-SHA256SUMS`。模块 ZIP 和浏览器安装包发布在同一 GitHub Release，但必须作为不同资产列出；模块永远不复制进扩展安装包。

## 10. PR 评审清单

- [ ] 功能确实需要网站模块，而不是通用核心功能；
- [ ] 作者、格式、ID、版本、描述和引用文件一致；
- [ ] 来源精确、最小且逐一测试；
- [ ] 没有 DNR、远程资源、账号数据、网络请求或扩展权限；
- [ ] 选择器不会隐藏主要控制、隐私提示或无障碍入口；
- [ ] 脚本事件有输入保护和安全降级，没有轮询或无界扫描；
- [ ] Chromium、Firefox、Safari 能力差异已记录；
- [ ] 真实模块文件通过导入测试和打包检查；
- [ ] README / Release 说明明确非官方状态和已知限制。
