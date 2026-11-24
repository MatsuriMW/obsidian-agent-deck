# 设计语言与 UI 规范

## 1. 样式分层架构（`src/styles/` → `styles.css`）
唯一正本在 `src/styles/`，由 `esbuild` 从 `src/styles/index.css` 打包生成根目录 `styles.css`（`npm run build`）；禁止直接修改 `styles.css`。导入严格遵循三层级联：

| 层级 | 模块（按导入顺序） | 边界与职责 |
| --- | --- | --- |
| **基础层** | `base/tokens.css` → `base/atoms.css` → `base/controls.css` | 作用域 `--ad-*` 变量与左对齐/焦点环；原子控件（重置 `appearance`/`border`/`box-shadow`）与 3×3 点阵；复合选择器（`.ad-targetpick` / `.ad-effort` / `.ad-modelpick` / `.ad-models-card`，跨上下文尺寸通过 `--ad-effort-*` 等局部 CSS 变量调节） |
| **视图层** | `views/dashboard.css` → `views/dashboard-cards.css` → `views/editor.css` → `views/keyword.css` → `views/record-views.css` → `views/settings.css` → `views/modals.css` → `views/review.css` | 侧栏骨架与 7 日图（`.ad-dash` 预留 `--ad-slack` 防叠放收起跳动）；会话卡/扑克牌叠放/Agent 卡片（`:where(.theme-light)` 降权微阴影）；编辑器行内 pill/进度/拖放/飞行残影；记录折叠与四视图投影（收敛在 `.ad-record-table-wrap`）；设置页；弹窗与时间线；回顾面板 |
| **动效层** | `base/motion.css`（置于末尾） | `@keyframes` 定义、失焦暂停呼吸（`body:not(.is-focused)`）与 `prefers-reduced-motion: reduce` 降级 |

- **作用域收敛**：各视图以原生 CSS 嵌套收敛在自身宿主根类下，避免顶层平铺泄漏；`.ad-view`、`.ad-settings`、`.ad-review` 通过 `container-type: inline-size` / `container` 做窄屏断点。

## 2. CSS Token（`src/styles/base/tokens.css`）
作用域限定在 `.ad-view`、`.ad-settings`、`.ad-modal`、`.ad-review`（`.ad-settings` 局部覆写 `--ad-radius: 10px`、`--ad-accent: var(--interactive-accent)`）：
- **表面与文字**：`--ad-surface` / `--ad-surface-2` / `--ad-ink` / `--ad-muted` / `--ad-faint` / `--ad-line`（映射 Obsidian `--background-*`、`--text-*`、`--background-modifier-*`）。
- **语义与识别色**：`--ad-accent: #746d94`、`--ad-good: #6f8f7c`、`--ad-warn: #a9845f`、`--ad-bad: #a86f6d`、`--ad-star: #b39a6a`；Agent 识别色由 JS 动态写入 `--ad-agent` / `--ad-agent-soft`。
- **圆角、阴影与数字**：`--ad-radius: 14px`、`--ad-radius-sm: 10px`、`--ad-shadow: 0 10px 30px rgba(55, 48, 42, .08)`、`--ad-figure: "SF Mono", "JetBrains Mono", ui-monospace, monospace`。
- **控件与浮层 Token**：`base/tokens.css` 提供 `--ad-ctrl-*`、`--ad-input-wide-w`、`--ad-input-num-w`、`--ad-btn-*`、`--ad-seg-on-shadow`、`--ad-btn-hover-y`，设置页（`.ad-settings`）通过覆写变量而非重复样式补丁切换桌面尺寸与扁平态；`base/atoms.css` 统一收纳按钮/输入框/开关基础重置与 `<details>/<summary>` 折叠三角（`ad-modelgroup__head`、`ad-subdetails__head`、`.ad-delegate-agent > summary`）；弹窗通过 `--ad-modal-w` 控制宽度（`.ad-cardmanager` 覆盖为 `100%`）。
- **容器外 DOM**：`views/editor.css`、`views/record-views.css` 及挂在 `body` 的 `.ad-fly-layer` 直接挂载于 Obsidian DOM，不在上述容器内，须使用 Obsidian 原生变量或显式 fallback。

## 3. 布局与交互约束
- **文字默认左对齐**：正文、标题、表单控件、选项卡片与设置按钮默认 `text-align: left`；仅右侧统计列、空状态占位与微图标胶囊例外。`:is(.ad-settings, .ad-review) ... :focus-visible` 共用统一键盘焦点环。
- **Agents 密度与侧栏分组**：`1–3` 个可见 Agent 显示详细横条，`4+` 个自动切换紧凑卡片；拖拽笔记无序/有序列表条目至侧栏时，支持委派的 Agent 卡片显示悬停高亮与动作徽标（`委派给` / `交给` / `在终端里开`），不支持委派的卡片（`.is-no-drop`，含 `trackingOnly` 项）在 `body.ad-dragging-item` 期间统一灰显降暗（`filter: grayscale(1)`、降透明、`cursor: not-allowed`）并在拖入时显示 `.is-drop-blocked` 中性提示徽标「暂不支持委派」且拒绝落放；「现在」支持「按项目 / 按状态 / 列表」三视图（只保留活跃运行、异常/限额/授权、排队及 30 分钟内非子代理等待；按状态分「等你 / 待认领 / 在跑 / 异常」四档，未认领的活跃委派单列，空档不出卡片），「最近的会话」支持「按 Agent / 按项目」与 `7 / 30 / 120 天` 切换及单页最多 30 张上限（展开收起保持视口锚定）。
- **记录折叠、视图切换与进度**：AI 记录默认只露出最新结论（或设置档位），手动开合持久化；最顶层 AI 记录母块行尾以视图切换入口（支持「大纲／表格／卡片／时间线」，按块持久化在 `aiRecordViews`）替代委派小箭头，委派与任务操作保留在视图菜单、状态 pill、命令面板与子回复行。视图菜单内的「导出」子菜单支持按当前视图输出 PDF/HTML，以及无损导出 Markdown / JSON / CSV 与剪贴板复用（Markdown / Markdown 表格 / 纯文本 / JSON）。表格／卡片／时间线视图仅作用于 CM6 编辑视图（阅读视图保留大纲），按母块下一级记录归组、深层非任务子块行内展开，字段缺失留空不估算，点击条目切回大纲并定位原块编辑。后台执行只显示一条母块下方的进度行与实时耗时，不再显示行尾 pill；螺旋日程能表示同一会话时让出进度显示。回答结束后移除 Agent Deck 补充的后台状态行；取消、重试和授权入口保留在进度行或任务菜单。**禁止把步骤数估算为完成百分比**。
- **任务关键词的视觉层**：`views/keyword.css` 与 `src/keyword-style.js` 把 Logseq Style Tasks（TODOseq，同一位作者的另一支插件）的关键词配色、`tsq-ico` 图标、动画以及完成/归档态文字整套接了过来，沿用它的类名（`todoseq-keyword-formatted` / `todoseq-completed-*`）与 `--tsq-*` 变量，因此两边看起来一致；TODOseq 的「格式化任务关键词」或「关键词图标」开着时本插件对应那一层让位（`todoSeqFormatsKeywords()` / `todoSeqRendersIcons()`），两个都关掉才整套接管，新装默认由 Agent Deck 渲染，并在「记录 → 日记与归档 → 关键词配色与图标」提供唯一开关。块首关键词同时识别全大写与全小写（如 `todo` / `doing` / `done`，忽略首字母大写普通英文正文）：编辑器与阅读视图保留原文大小写展示，并在 DOM 属性（`data-task-keyword` / `data-kw`）归一化为大写以复用配色与图标规则。AI 自动记录（整行带 `🤖`）不是待办：完成态不给关键词与正文加删除线，这条在渲染时决定而不是 CSS 覆盖。
- **AI 记录图标微排版与去重可见性**：每轮结论前（`第N轮：` / 历史 `💬 第N轮：`）渲染的圆圈徽标 `.ad-round-badge` 采用 `16×16`、`inline-flex`、`flex-shrink: 0`、`vertical-align: middle; position: relative; top: -0.15em;`、`cursor: default` 与悬停边框增强，内层数字 `.ad-round-badge__num` 使用 `text-box-trim: trim-both; text-box-edge: cap alphabetic;` 实现光学居中，并附带本地化 `title` / `aria-label`（`t("第 {n} 轮", { n })`）；任务行小图标 `.ad-agent-mark` 为 `16×16`、`top: -0.09em`。设置页「记录」卡片统计过滤已被 `delegatedOwnerOf` 归并的底层会话，且启用的 T3 Code / Cindy 卡片底部展示 `.ad-hint` 去重说明与实时计数。
- **更多设置**：功能较多的区域保留模型、权限、常用开关和主要操作；CLI 路径、额外参数、扫描频率、超时、批量阈值、模板细节、显示数量及维护操作放进默认折叠的“更多设置”。每项设置保留唯一入口，折叠不改变配置值。
- **设置页结构**：固定 **委派、记录、Dreaming、实验功能、关于** 五页，每项设置只保留唯一编辑入口；关闭实验功能时隐藏入口并关闭已打开页，保留统计与用户更正。

## 4. 验收矩阵
- 语言：`zh` / `zh-TW` / `en`（含 `Agent Deck/locales/*.json` 自定义语言包回退） ｜ 主题：Light + Dark ｜ 宽度：`360px` / `480–600px` / `675–858px+`（无页面级横向溢出）｜ 构建：`npm run build` 同步产出 `styles.css`。
