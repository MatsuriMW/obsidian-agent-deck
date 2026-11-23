# 界面语言 / UI language

默认跟随 Obsidian 自己的界面语言自动切换，也可在「设置 → 关于 → 界面语言」里手动指定并持久化到 `data.json`（`settings.uiLanguage`），更新插件不会重置。

## 判定与自定义语言包

- **内置语系**：`auto`（跟随 Obsidian `localStorage["language"]`）、`zh`（简体中文）、`zh-TW`（繁體中文，内置表 `src/locales/zh-TW.js`）、`en`（English）。`auto` 模式下 `zh-TW`/`zh-HK`/`zh-MO`/`zh-Hant` 自动识别为 `zh-TW`，其余精确命中已加载的自定义语言包则选中，否则 `zh*` → `zh`，其余 → `en`。
- **自定义语言包（升级不覆盖）**：插件启动及点击「重新扫描语言包」时会扫描 Vault 内 `Agent Deck/locales/*.json`（优先）与插件目录 `.obsidian/plugins/agent-deck/locales/*.json`（忽略 `template.json`）。格式为扁平 `{ "中文原文": "译文" }`，可选 `"_meta": { "name": "日本語" }`。放入 `zh-TW.json` 也可局部覆盖内置繁體中文词条。可在「设置 → 关于 → 界面语言」一键导出 `Agent Deck/locales/template.json` 交给 AI 翻译。
- **回退策略**：`zh-TW` 优先查用户自定义 `zh-TW` 覆盖包，再查内置 `src/locales/zh-TW.js`，最后回退中文原文；其他自定义语言包缺少某条词条时，`zh*` 回退简体中文原文，其余语系先回退英文再回退中文原文。

## 写法

中文原文本身就是翻译 key（gettext 风格），缺英文时自动回退中文，不会露出 key。

```js
import { t } from "./i18n.js";

t("打开面板");                                  // 直接替换
t("共 {n} 个", { n: list.length });              // 占位符用 {name}
```

- key 必须是字面量，不要拼接、不要用变量。
- 占位符统一 `{name}`，不要写 `${}`。
- 文件里如果有局部变量叫 `t`（`for (const t of …)`），要么改名，要么 `import { t as tr }`（CM6 `StateField` 等回调参数亦严禁命名为 `tr`，统一用 `tx`）。
- `src/locales/zh-TW.js` 的键名必须保持与 `src/` 中 `t("...")` 完全一致的**简体中文**字面量，禁止把 key 本身转成繁体；仅在界面悬浮提示/`aria-label` 等 UI 展示文本（如 `src/record-icons.js` 的 `t("第 {n} 轮", { n })`）走翻译，写入笔记的 Markdown 原文（如 `第N轮：`）保持不变。

## 英文表

按模块分片，`src/locales/en/*.js`，由 `src/locales/en.js` 合并：

| 分片 | 覆盖 |
| --- | --- |
| `main.js` | 命令面板、状态栏、通知 |
| `view.js` | 主面板、AI 记录显示、归档与归组提示 |
| `dashboard.js` | 实验回顾 Dashboard |
| `settings.js` | 设置页五个标签页（委派、记录、Dreaming、实验功能、关于） |
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
