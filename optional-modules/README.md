# Hourleaf 可选本地模块

这里的文件不会进入浏览器商店包，也不会被已安装的 Hourleaf 自动下载或更新。

优先从 [GitHub Releases](https://github.com/446F7269616E/Hourleaf/releases/latest) 下载单个模块 ZIP。Release 资产与浏览器扩展安装包分开，不会预装或自动更新模块。

使用步骤：

1. 下载并解压所需模块的 ZIP；
2. 阅读模块的 JSON 清单及其引用的 CSS / `.user.js` 文件；
3. 在 Hourleaf“设置 → 模块设置”中选择这些本地文件；
4. 核对网站范围与能力后，由你主动授权并启用。

导入文件应视为第三方本地代码。请只导入你已经阅读、理解并信任的内容。商店核心不会通过 URL、更新清单或后台任务拉取这里的代码。

当前模块：

- `Bilibili 专注模块`：从仓库历史适配恢复并按当前安全边界重写，提供常见干扰元素过滤和 `/` 聚焦搜索；非 Bilibili 官方模块。

作者开发新模块前请阅读 [模块开发准则](../docs/MODULE_DEVELOPMENT.md)；完整协议见 [本地模块规范](../docs/LOCAL_MODULES.md)。
