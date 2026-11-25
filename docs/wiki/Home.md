**中文** ｜ [English](Home.en)

# Agent Deck Wiki

> **以 Markdown / 大纲 / 日记为正本的多客户端 AI 总控台 + 长期记忆闭环。**

欢迎来到 **Agent Deck（智能体甲板）** 的用户文档。无论你是第一次把本地 AI 会话接入 Obsidian，还是想搭建「日记派活 → 多 Agent 并发 → Dreaming 长期记忆反哺」的完整闭环，都可以从这里快速查到对应指南。

## 核心定位

- **Markdown / 大纲 / 日记为正本**：所有 AI 追踪记录、任务状态、派发草稿/快照、技能卡与长期记忆都以普通 Markdown 存回你的 Obsidian 库，无黑盒数据库，手改即生效，手改过的标题和正文永不被覆盖。
- **多客户端总控台**：统一收拢本机 **21 家内置 Agent + 任意自定义 ACP CLI**，全面覆盖 **Claude、GPT / Codex、Gemini、DeepSeek、Qwen（千问）、MiniMax、Kimi、豆包、Grok** 及本地 Ollama 等主流模型；特别针对 **DeepSeek Harness、MiniMax Code、千问办公（QwenWork）、Qoder、WorkBuddy、Kimi Code、豆包工作、TeleAgent、Trae（Trae CN / 国际版）** 等中文 Agent 客户端，以及 **T3 Code / Cindy / Orca** 等聚合端（自动去重底层拉起的会话）做了本地追踪与适配。
- **长期记忆闭环**：干活过程自动记入日记，Dreaming 将近期日记与委派沉淀为一文一条的可编辑记忆（附原文溯源回链），下次派活按相关度自动注入，形成持续进化的个人/项目上下文闭环。

## 文档导航

| 页面 | 适合谁看 |
| --- | --- |
| [[快速上手\|Quick-Start]] | 首次安装、3 分钟跑通会话追踪、日记自动记录与任务派发 |
| [[支持的 Agent 与主流模型\|Supported-Agents-and-Models]] | 21 家内置客户端（含中文 Agent 生态与前置安装要求）、自定义 ACP 与模型矩阵、各客户端边界 |
| [[核心工作流：Markdown 即 Harness\|Workflow-Markdown-Harness]] | 从笔记派活、`@` / `/` 补全、问答闭环、四种记录视图、原地分形看板与技能卡 |
| [[长期记忆闭环（Dreaming）\|Long-Term-Memory-Dreaming]] | 一文一条记忆库、Base 表格与记忆看板、溯源回链、体检与隐私边界 |
| [[常见问题与排错\|FAQ-and-Troubleshooting]] | macOS PATH、Trae / Cursor Hooks 前置开启步骤、Windows 适配现状、密钥安全与脱敏诊断导出 |

## 常用链接

- [仓库首页（English README）](https://github.com/MatsuriMW/obsidian-agent-deck/blob/main/README.md) ｜ [中文 README](https://github.com/MatsuriMW/obsidian-agent-deck/blob/main/README.zh-CN.md)
- [GitHub Releases（下载与版本说明）](https://github.com/MatsuriMW/obsidian-agent-deck/releases)
- [Roadmap 与功能投票](https://matsuri.site/portfolio/journal-workflow/#wishlist)
- [GitHub Discussions（讨论与经验分享）](https://github.com/MatsuriMW/obsidian-agent-deck/discussions) ｜ [GitHub Issues（Bug 反馈）](https://github.com/MatsuriMW/obsidian-agent-deck/issues)
