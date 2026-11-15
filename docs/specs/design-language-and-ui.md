# 设计语言与 UI 规范

## 1. 样式分层架构（`src/styles/` → `styles.css`）
唯一正本在 `src/styles/`，由 `esbuild` 从 `src/styles/index.css` 打包生成根目录 `styles.css`（`npm run build`）；禁止直接修改 `styles.css`。导入严格遵循三层级联：

| 层级 | 模块（按导入顺序） | 边界与职责 |
| --- | --- | --- |
| **基础层** | `base/tokens.css` → `base/atoms.css` → `base/controls.css` | 作用域 `--ad-*` 变量与左对齐/焦点环；原子控件（重置 `appearance`/`border`/`box-shadow`）与 3×3 点阵；复合选择器（`.ad-targetpick` / `.ad-effort` / `.ad-modelpick` / `.ad-models-card`，跨上下文尺寸通过 `--ad-effort-*` 等局部 CSS 变量调节） |
| **视图层** | `views/dashboard.css` → `views/dashboard-cards.css` → `views/editor.css` → `views/record-views.css` → `views/settings.css` → `views/modals.css` → `views/review.css` | 侧栏骨架与 7 日图（`.ad-dash` 预留 `--ad-slack` 防叠放收起跳动）；会话卡/扑克牌叠放/Agent 卡片（`:where(.theme-light)` 降权微阴影）；编辑器行内 pill/进度/拖放/飞行残影；记录折叠与四视图投影（收敛在 `.ad-record-table-wrap`）；设置页；弹窗与时间线；回顾面板 |
| **动效层** | `base/motion.css`（置于末尾） | `@keyframes` 定义、失焦暂停呼吸（`body:not(.is-focused)`）与 `prefers-reduced-motion: reduce` 降级 |

- **作用域收敛**：各视图以原生 CSS 嵌套收敛在自身宿主根类下，避免顶层平铺泄漏；`.ad-view`、`.ad-settings`、`.ad-review` 通过 `container-type: inline-size` / `container` 做窄屏断点。

## 2. CSS Token（`src/styles/base/tokens.css`）
作用域限定在 `.ad-view`、`.ad-settings`、`.ad-modal`、`.ad-review`（`.ad-settings` 局部覆写 `--ad-radius: 10px`、`--ad-accent: var(--interactive-accent)`）：
- **表面与文字**：`--ad-surface` / `--ad-surface-2` / `--ad-ink` / `--ad-muted` / `--ad-faint` / `--ad-line`（映射 Obsidian `--background-*`、`--text-*`、`--background-modifier-*`）。
- **语义与识别色**：`--ad-accent: #746d94`、`--ad-good: #6f8f7c`、`--ad-warn: #a9845f`、`--ad-bad: #a86f6d`、`--ad-star: #b39a6a`；Agent 识别色由 JS 动态写入 `--ad-agent` / `--ad-agent-soft`。
- **圆角、阴影与数字**：`--ad-radius: 14px`、`--ad-radius-sm: 10px`、`--ad-shadow: 0 10px 30px rgba(55, 48, 42, .08)`、`--ad-figure: "SF Mono", "JetBrains Mono", ui-monospace, monospace`。
- **容器外 DOM**：`views/editor.css`、`views/record-views.css` 及挂在 `body` 的 `.ad-fly-layer` 直接挂载于 Obsidian DOM，不在上述容器内，须使用 Obsidian 原生变量或显式 fallback。

## 3. 布局与交互约束
- **文字默认左对齐**：正文、标题、表单控件、选项卡片与设置按钮默认 `text-align: left`；仅右侧统计列、空状态占位与微图标胶囊例外。`:is(.ad-settings, .ad-review) ... :focus-visible` 共用统一键盘焦点环。
- **Agents 密度**：`1–3` 个可见 Agent 显示详细横条，`4+` 个自动切换紧凑卡片。
- **记录折叠、视图切换与进度**：AI 记录默认只露出最新结论（或设置档位），手动开合持久化；最顶层 AI 记录母块行尾以视图切换入口（支持「大纲／表格／卡片／时间线」，按块持久化在 `aiRecordViews`）替代委派小箭头，委派与任务操作保留在视图菜单、状态 pill、命令面板与子回复行。视图菜单内的「导出」子菜单支持按当前视图输出 PDF/HTML，以及无损导出 Markdown / JSON / CSV 与剪贴板复用（Markdown / Markdown 表格 / 纯文本 / JSON）。表格／卡片／时间线视图仅作用于 CM6 编辑视图（阅读视图保留大纲），按母块下一级记录归组、深层非任务子块行内展开，字段缺失留空不估算，点击条目切回大纲并定位原块编辑。后台执行只显示一条母块下方的进度行与实时耗时，不再显示行尾 pill；螺旋日程能表示同一会话时让出进度显示。回答结束后移除 Agent Deck 补充的后台状态行；取消、重试和授权入口保留在进度行或任务菜单。**禁止把步骤数估算为完成百分比**。
- **更多设置**：功能较多的区域保留模型、权限、常用开关和主要操作；CLI 路径、额外参数、扫描频率、超时、批量阈值、模板细节、显示数量及维护操作放进默认折叠的“更多设置”。每项设置保留唯一入口，折叠不改变配置值。
- **设置页结构**：固定 **委派、记录、Dreaming、实验功能、关于** 五页，每项设置只保留唯一编辑入口；关闭实验功能时隐藏入口并关闭已打开页，保留统计与用户更正。

## 4. 验收矩阵
- 语言：`zh*` + `en` ｜ 主题：Light + Dark ｜ 宽度：`360px` / `480–600px` / `675–858px+`（无页面级横向溢出）｜ 构建：`npm run build` 同步产出 `styles.css`。
