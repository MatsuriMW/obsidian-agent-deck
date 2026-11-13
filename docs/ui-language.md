# 界面语言 / UI language

插件跟随 Obsidian 自己的界面语言自动切换，不需要单独设置。

## 判定

Obsidian 把界面语言存在 `localStorage` 的 `language` 里（`zh`、`zh-TW`、`en`…）。
`src/i18n.js` 的 `detectLanguage()` 只区分两种结果：`zh*` → 中文，其余一律英文。
没取到值时退回 `navigator.language`，再退回英文。

## 写法

中文原文本身就是翻译 key（gettext 风格），缺英文时自动回退中文，不会露出 key。

```js
import { t } from "./i18n.js";

t("打开面板");                                  // 直接替换
t("共 {n} 个", { n: list.length });              // 占位符用 {name}
```

- key 必须是字面量，不要拼接、不要用变量。
- 占位符统一 `{name}`，不要写 `${}`。
- 文件里如果有局部变量叫 `t`（`for (const t of …)`），要么改名，要么 `import { t as tr }`。

## 英文表

按模块分片，`src/locales/en/*.js`，由 `src/locales/en.js` 合并：

| 分片 | 覆盖 |
| --- | --- |
| `main.js` | 命令面板、状态栏、通知 |
| `view.js` | 主面板、AI 记录显示、归档与归组提示 |
| `settings.js` | 设置页六个标签页 |
| `dialogs.js` | 委派对话框、对话窗口、任务操作菜单 |
| `writers.js` | 自动记日记、Dreaming、共享记忆 |
| `runtime.js` | 读日志、同步、模型调用、Codex 桌面版 |
| `editor.js` | 笔记里的状态 pill、拖放提示 |
| `menubar.js` | macOS 菜单栏（同时作为 Swift 侧的 `labels` 表） |

## 不要翻译的东西

写进用户笔记的文字（任务行前缀、`🔗`/`💬`/`⏱` 行、Markdown）、状态关键词与匹配逻辑、
文件路径、CSS class、JSON 字段、agent/模型 id、发给 CLI 或 LLM 的 prompt、console 调试输出。

判断标准：这段文字会被程序再读回去做判断、被写进笔记、或发给外部进程吗？会 → 不动。

## macOS 菜单栏

Swift helper 把中文常量编进二进制，插件在 `menubar.json` 里带一个 `labels` 映射
（中文原文 → 当前语言文本）。Swift 侧统一走 `L("中文原文")` 查表，查不到就用文件里的中文。
所以加一条菜单栏文案要同时改 `src/menubar.swift` 和 `src/locales/en/menubar.js`。

## 测试

`test/i18n.test.mjs` 检查四件事：英文表里没有残留中文、分片之间没有重复 key、
`src/` 里每个 `t("…")` 调用都有对应英文、占位符两边一致。加新文案后跑一次就知道漏没漏。
