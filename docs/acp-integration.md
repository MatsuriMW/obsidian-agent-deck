### ACP availability versus integration

ACP (Agent Client Protocol) defines task and session messaging. ACP support does not guarantee that a desktop application will display or resume the same session. Checked on 2026-11-13.

| Agent | ACP availability | Current Agent Deck integration |
|---|---|---|
| DeepSeek Harness | Official `dsh acp`; [protocol reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/README.md) | ACP delegation and in-plugin follow-up |
| Claude / Claude Code | [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp) exposes Claude Agent SDK through ACP | Direct `claude` CLI; no ACP adapter used |
| Codex | [codex-acp](https://github.com/agentclientprotocol/codex-acp) translates ACP into Codex App Server operations | Direct [App Server](https://developers.openai.com/codex/app-server/) or terminal; ACP adapter not required |
| CodeBuddy / WorkBuddy | CodeBuddy CLI documents [`codebuddy --acp`](https://www.codebuddy.ai/docs/cli/acp). This does not establish standalone ACP compatibility for both WorkBuddy desktop editions | WorkBuddy client handoff; independent CLI sessions are not WorkBuddy desktop sessions |
| Antigravity | Official [`agy acp`](https://antigravity.google/docs/cli/acp), with a compatible CLI version and authentication | Native ACP delegation, model discovery, permission prompts, same-session follow-up and text export |

Local `agy 1.5.6` passed a real two-turn task: the first turn returned `AGY_391`; the second resumed the same session and recalled the first turn's passphrase. Displaying CLI sessions in Antigravity IDE was not verified or promised.
