# Hourleaf 本地模块规范

## 分发与信任边界

Hourleaf 的商店包只包含通用专注核心和本地模块导入器。扩展不会读取 GitHub 模块目录、远程更新清单或任意 URL 来获取逻辑。用户必须先在浏览器外下载文件，再通过文件选择器明确导入。

本地模块最多 32 个。每个模块最多声明 32 个精确 HTTP(S) 来源、128 个元素选择器、100 KB CSS 和 150 KB 用户脚本。通配主机、凭据 URL、远程文件引用、DNR 规则和跨 frame 脚本均会被拒绝。

仓库维护的模块源码位于 `optional-modules/<slug>/`。`npm run package` 会验证基础元数据和引用文件集合，再为每个目录生成独立的 `dist/modules/hourleaf-module-<slug>-<version>.zip` 与 SHA-256；这些资产只发布到 GitHub Release，不进入三平台扩展安装包。

所有可导入内容必须声明非空作者名称和固定格式标识 `hourleaf.local-module`。格式不从扩展名猜测，也不会为旧文件自动补全作者。

## 能力矩阵

| 能力               | Chromium 商店版                           | Firefox AMO 版                  | Safari App Store 版              |
| ------------------ | ----------------------------------------- | ------------------------------- | -------------------------------- |
| 精确域名计时与名单 | 支持                                      | 支持                            | 支持                             |
| 元素隐藏与 CSS     | 支持                                      | 支持                            | 支持                             |
| 本地 DNR 动态规则  | 禁用                                      | 禁用                            | 禁用                             |
| 用户脚本           | 仅 User Scripts API，需用户在扩展详情启用 | 仅 User Scripts API，需可选权限 | 禁用；Apple 商店包不执行导入代码 |

用户脚本固定运行在浏览器的 `USER_SCRIPT` 隔离世界、`document_idle`、顶层 frame，不获得 Hourleaf 的 storage、permissions、tabs 或其他扩展 API。核心不使用 `eval`、`Function`、script 标签或 `scripting.executeScript({code})` 执行导入文本。

## JSON 清单

```json
{
  "schemaVersion": 1,
  "format": "hourleaf.local-module",
  "id": "example.local.focus",
  "name": "Example Focus",
  "author": "Example Author",
  "version": "1.0.0",
  "description": "可选说明",
  "matches": ["https://example.com/*"],
  "domainPolicy": "timed",
  "hideSelectors": [".recommendations"],
  "cssFiles": ["focus.css"],
  "userScriptFiles": ["focus.user.js"]
}
```

- `domainPolicy`：`timed`、`always-allow` 或 `always-block`。黑名单优先于白名单；插件总开关关闭时两者都暂停。
- `format`：必须为 `hourleaf.local-module`；`author` 必须是 1–100 个字符的非空文本。
- `hideSelectors`：只生成 `display: none !important` 规则。
- `css` / `cssFiles`：内联 CSS 或同一次文件选择中按名称引用的本地 CSS；`@import` 和所有 `url()` 外部资源都会被拒绝。
- `dnrRules`：为兼容 schema 可省略或保留空数组；任何非空规则都会被拒绝。浏览器 DNR 的 `initiatorDomains` 只能表达域名并会覆盖子域，无法兑现 Hourleaf 的精确协议、主机和端口来源契约。
- `userScript` / `userScriptFiles`：仅通过 User Scripts API 注册。

清单不能引用网络 URL。引用文件必须与清单在同一次导入中由用户选择。

## 独立 CSS / User Script

没有 JSON 清单时，文件头必须包含 `@format`、`@id`、`@name`、`@author`、`@version` 和至少一个精确 `@match`：

```text
// ==UserScript==
// @format  hourleaf.local-module
// @id      example.local.script
// @name    Example Script
// @author  Example Author
// @version 1.0.0
// @match   https://example.com/*
// ==/UserScript==
```

`.css` 可使用同样的元数据行。没有 JSON 清单时，每个所选文件都必须完整声明 `@format`、`@id`、`@name`、`@author`、`@version` 和至少一个 `@match`；同次文件的格式、ID、名称、作者与版本必须一致。多个文件一起导入时会合并为一个模块，但不会跟随任何外部引用。

## 导入确认与安全边界

导入确认页必须显示模块名称、作者、格式、版本、精确网站范围和能力。用户必须明确确认：安全检测只是有限防线，不代表 Hourleaf 已审核或担保第三方内容安全；用户应先阅读来源并自行承担导入与运行风险。未确认时不得发起网站授权或导入。

`createLocalModuleImportPreview()` 提供不持久化的确认页数据：`author`、`format`、`version`、`matches`、`capabilities`、`hasUserScript` 以及 `riskDisclosure`。`riskDisclosure.code` 固定为 `review-content-and-assume-risk`，且 `acknowledgementRequired` 固定为 `true`；UI 应用本地化文案显示免责说明，不应把错误码或英文能力名直接呈现给用户。确认后，`IMPORT_LOCAL_MODULE` 还必须携带同一个固定 code，特权消息边界会拒绝缺失或伪造的确认值。

导入器对最多 150 KB 的脚本做一次线性、有限的静态检查，拒绝以下明显不符合专注模块边界的功能：

- `eval` / `Function`、字符串计时器、动态 `import`、`importScripts` 和 WebAssembly 代码生成；
- `fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource` 和 `sendBeacon` 直接外联；
- 常见扩展特权 API 访问、动态 `<script>` 元素注入和 `document.cookie` 访问。

扫描器以一次有界线性遍历识别字符串与注释边界，再检查点号、方括号成员和限定构造器等常见写法，避免字符串中的 `/*` / `*/` 吞掉后续危险代码。这不是通用 JavaScript 恶意代码扫描器，不解压、不解混淆、不追踪别名或数据流，也不保存扫描报告。代码仅在导入和特权边界做同样的归一化；通过后仍只能由浏览器 `USER_SCRIPT` 隔离世界执行。

## 错误码与恢复

`LocalModuleImportError` 提供稳定 `code`、简短默认消息和 `recoverable: true`。UI 可按错误码做多语言映射：

| 错误码                                                       | 用户恢复方向                       |
| ------------------------------------------------------------ | ---------------------------------- |
| `selection-required` / `file-limit-exceeded`                 | 重新选择 1–16 个文件               |
| `invalid-file` / `duplicate-file` / `unsupported-file-type`  | 修正文件名、大小、重名或类型       |
| `multiple-manifests` / `invalid-json` / `invalid-manifest`   | 只保留一个有效 JSON 清单并修正字段 |
| `invalid-reference` / `missing-reference`                    | 修正清单引用或同时选择被引用文件   |
| `metadata-required` / `metadata-conflict`                    | 补全并统一独立文件头               |
| `author-required` / `format-required` / `unsupported-format` | 填写作者并改用标准格式标识         |
| `unsupported-dnr`                                            | 移除所有非空 DNR 规则              |
| `unsafe-css` / `unsafe-user-script`                          | 移除外联资源或被禁高风险功能       |

## 迁移影响

作者、格式标识和空 DNR 是 schema v1 的安全收紧。升级后，本地存储中缺少 `author`、缺少 `format: "hourleaf.local-module"` 或包含非空 DNR 的旧安装不再进入运行时；初始化会清理 Hourleaf 旧版本注册的本地模块 DNR ID 区间。作者需要先更新原始文件，用户再手动重新导入；Hourleaf 不会猜测作者或自动将旧文件标记为已信任。
