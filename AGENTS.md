# Agent Deck · 开发与交接原则

## 源码边界与隔离
- **唯一正本**：`src/` 与 `src/menubar.swift`；禁止直接修改 Vault `.obsidian/plugins/agent-deck/` 产物。
- **Apache-2.0 公开隔离**：遵循 [`LICENSE`](LICENSE) / [`NOTICE`](NOTICE)；Magpie、Multica、螺旋日程、Telegram Companion 与个人主库路径只做运行时探测的可选集成。
- **README 原则**：[`README.md`](README.md) / [`README.en.md`](README.en.md) 只面向用户说明能力、安装依赖与限制；版本流水账留 [`CHANGELOG.md`](CHANGELOG.md)。

## 核心不变式
1. **笔记无损**：保留手写内容、代码块、会话链接与用户改过的 AI 标题（跳过空格压缩与前缀剥离）；模型调用不得占用按文件排队的写入锁。
2. **适配器隔离**：客户端差异留在适配器层；写入格式、短链 `[🔗](url)`、块号清理与 token 让渡走公共统一规则。
3. **口径诚实与缓存迁移**：`data.json`（`STORE_VERSION = 1`）与 `usage.json` 无损迁移；改动日志解析或清洗规则时递增 `src/readers.js` 的 `USAGE_CACHE_VERSION`（当前 `6`）；缺失 token 与活跃耗时绝不估算。
4. **UI 与双语**：复用 [`styles.css`](styles.css) `--ad-*` 变量，默认左对齐，设置页 5 页且每项唯一入口；文案遵循 [`docs/specs/ui-language.md`](docs/specs/ui-language.md)（菜单栏同步 `src/menubar.swift` 与 `src/locales/en/menubar.js`）。
5. **双平台诚实**：`darwin` 专属能力（如 `src/menubar.js`）在 Windows 无报错降级；单平台实测不外推为双平台通过。

## 接手与交接
- **入口**：[`docs/task-workflow.zh-CN.md`](docs/task-workflow.zh-CN.md) + [`docs/specs/`](docs/README.md)。
- **命令**：`npm test && npm run build && git diff --check`；安装 `npm run install:plugin -- <Vault路径>`；Mac 热重载 `obsidian vault=马自立 plugin:reload id=agent-deck`。
- **交接**：同步更新受影响的 `docs/specs/*.md`、[`docs/task-workflow.zh-CN.md`](docs/task-workflow.zh-CN.md)（实测平台与未测空白）及 Linear `P-MAT-42`。未经确认不改版本号或打 tag。
