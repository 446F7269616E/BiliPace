# Hourleaf 威胁模型

## 范围与资产

范围包括三个浏览器构建、扩展页、content script、background、local storage、可选网站权限、动态脚本注册、站点模块和发布供应链。需保护的资产是用户规则、计划、聚合时长、浏览活动隐私、扩展权限、更新渠道和发布凭据。

## 信任边界

```text
不可信网站 DOM/脚本 ─► content script ─► 特权 background ─► local storage
                               ▲                    ▲
                               │                    │
                     reviewed site module     extension pages

source/dependencies ─► CI/build ─► store signing/review ─► browser profile
```

所有网页、DOM、URL、模块事件和 content-script 消息都不可信。扩展页与 background 是特权区，但仍需抵抗 DOM XSS、损坏 storage 和供应链攻击。本地 storage 不抵抗已控制设备/profile 的攻击者，因此不保存敏感网页内容。

## 主要威胁

| 威胁                       | 影响                   | 缓解                                                                    |
| -------------------------- | ---------------------- | ----------------------------------------------------------------------- |
| 可选范围被当成默认全站权限 | 扩大浏览数据暴露       | 只在用户点击后申请精确 origin；撤销后注销 content script                |
| 远程模块/配置执行          | 绕过商店审核           | 只注册随包审核的本地模块；禁止远程 JS/Wasm/eval/指令解释器              |
| 恶意模块扩大主机或能力     | 越权访问               | descriptor 有界校验；主机、路由、选择器、能力白名单；核心拥有存储与权限 |
| 网页伪造消息               | 特权操作或泄露         | 验证 sender、origin、permission、消息版本、类型和值域                   |
| DOM XSS/CSS 逃逸           | 扩展代码执行或锁死页面 | 安全 DOM API、严格 CSP、选择器有界、未知 DOM 安全放行、可退出遮罩       |
| 统计过细                   | 推断浏览习惯           | 只保存日期+TargetId+秒数；普通浏览不存完整 URL/标题                     |
| 计划授权重放               | 打开未选择页面         | 授权绑定 itemId+identity+绝对过期时间；修改/完成/删除即撤销             |
| 心跳重放/休眠补时          | 统计膨胀               | 随机会话 ID、单活动会话、差值上限、idle/visibility/focus 检查           |
| storage 损坏/资源耗尽      | 崩溃或持久错误         | schema、数量/长度上限、归一化、幂等迁移、安全默认值                     |
| 发布供应链接管             | 向用户推送恶意版本     | 锁依赖、可复现构建、校验和、MFA、最小发布权限、签名商店渠道             |

## 模块边界

站点模块可以分类 URL、提供有限选择器和规范化页面身份，但不能：

- 调用任意浏览器 API、读取任意 storage key；
- 读取 Cookie、密码、账号或页面正文并持久化；
- 添加未声明主机、远程脚本或任意 CSS/HTML；
- 绕过用户的网站开关、权限、时间规则或计时条件。

Bilibili 模块只处理已声明域名。ShadowRoot 兼容失效时停止增强，不隐藏未知容器；不启用 `all_frames`，避免重复会话。

## 剩余风险

- 网站改版可能让模块分类或选择器短暂失效；安全降级降低破坏面。
- 浏览器对焦点、冻结、移动端后台和 idle 的报告不同；统计是专注辅助数据，不是审计计量。
- 拥有设备/profile 权限的人可能读取或修改本地数据。
- Safari/Firefox 生命周期和权限提示与 Chromium 不同，必须用签名候选手工验证。

新增账户、同步、遥测、远程 API/配置、第三方 SDK、新权限或可执行模块格式时，必须在实现前重新评审本文件与 `PRIVACY.md`。
