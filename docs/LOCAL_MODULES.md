# Hourleaf 本地模块规范

## 分发与信任边界

Hourleaf 的商店包只包含通用专注核心和本地模块导入器。扩展不会读取 GitHub 模块目录、远程更新清单或任意 URL 来获取逻辑。用户必须先在浏览器外下载文件，再通过文件选择器明确导入。

本地模块最多 32 个。每个模块最多声明 32 个精确 HTTP(S) 来源、128 个元素选择器、1000 条安全 DNR 规则、100 KB CSS 和 150 KB 用户脚本。通配主机、凭据 URL、远程文件引用和跨 frame 脚本均会被拒绝。

## 能力矩阵

| 能力               | Chromium 商店版                           | Firefox AMO 版                  | Safari App Store 版              |
| ------------------ | ----------------------------------------- | ------------------------------- | -------------------------------- |
| 精确域名计时与名单 | 支持                                      | 支持                            | 支持                             |
| 元素隐藏与 CSS     | 支持                                      | 支持                            | 支持                             |
| 安全 DNR 动态规则  | 支持                                      | 支持                            | 支持的平台子集                   |
| 用户脚本           | 仅 User Scripts API，需用户在扩展详情启用 | 仅 User Scripts API，需可选权限 | 禁用；Apple 商店包不执行导入代码 |

用户脚本固定运行在浏览器的 `USER_SCRIPT` 隔离世界、`document_idle`、顶层 frame，不获得 Hourleaf 的 storage、permissions、tabs 或其他扩展 API。核心不使用 `eval`、`Function`、script 标签或 `scripting.executeScript({code})` 执行导入文本。

## JSON 清单

```json
{
  "schemaVersion": 1,
  "id": "example.local.focus",
  "name": "Example Focus",
  "version": "1.0.0",
  "description": "可选说明",
  "matches": ["https://example.com/*"],
  "domainPolicy": "timed",
  "hideSelectors": [".recommendations"],
  "cssFiles": ["focus.css"],
  "dnrRules": [
    {
      "action": "block",
      "urlFilter": "||ads.example.com^",
      "resourceTypes": ["script", "image"]
    }
  ],
  "userScriptFiles": ["focus.user.js"]
}
```

- `domainPolicy`：`timed`、`always-allow` 或 `always-block`。黑名单优先于白名单；插件总开关关闭时两者都暂停。
- `hideSelectors`：只生成 `display: none !important` 规则。
- `css` / `cssFiles`：内联 CSS 或同一次文件选择中按名称引用的本地 CSS；`@import` 和所有 `url()` 外部资源都会被拒绝。
- `dnrRules`：只允许 `block`、`allow`、`upgradeScheme`；运行时 ID 和 `initiatorDomains` 由核心生成，模块不能影响未声明网站。
- `userScript` / `userScriptFiles`：仅通过 User Scripts API 注册。

清单不能引用网络 URL。引用文件必须与清单在同一次导入中由用户选择。

## 独立 CSS / User Script

没有 JSON 清单时，文件头必须包含 `@id`、`@name`、`@version` 和至少一个精确 `@match`：

```text
// ==UserScript==
// @id      example.local.script
// @name    Example Script
// @version 1.0.0
// @match   https://example.com/*
// ==/UserScript==
```

`.css` 可使用同样的元数据行。多个文件一起导入时会合并为一个模块，但不会跟随任何外部引用。
