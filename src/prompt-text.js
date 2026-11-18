// User text shared by session readers and journal writeback.

export function cleanUserPrompt(raw) {
  const s = String(raw || "");
  if (!s) return "";
  if (/^\s*<send_user_message_question_reply>/.test(s)) {
    try {
      const payload = JSON.parse(s.trim().replace(/^<send_user_message_question_reply>\s*/, "").replace(/\s*<\/send_user_message_question_reply>$/, ""));
      if (!Array.isArray(payload)) return "";
      return payload.flatMap(item => {
        const answers = Array.isArray(item?.answer) ? item.answer : [item?.answer];
        return answers.filter(answer => typeof answer === "string" && answer.trim())
          .map(answer => `确认：${answer.trim()}${typeof item.question === "string" && item.question.trim() ? `（${item.question.trim()}）` : ""}`);
      }).join("\n");
    } catch { return ""; }
  }
  const m = s.match(/<(?:user_message|user_query|USER_REQUEST)>\s*([\s\S]*?)\s*<\/(?:user_message|user_query|USER_REQUEST)>/i);
  const body = m && m[1].trim() ? m[1] : s;
  return body
    .replace(/<system-reminder\b[^>]*>[\s\S]*?<\/system-reminder>/gi, "")
    .replace(/<(?:ADDITIONAL_METADATA|USER_SETTINGS_CHANGE|CONTEXT_SUMMARY|environment_context|user_instructions)\b[^>]*>[\s\S]*?<\/(?:ADDITIONAL_METADATA|USER_SETTINGS_CHANGE|CONTEXT_SUMMARY|environment_context|user_instructions)>/gi, "")
    .replace(/<image_local_path>[\s\S]*?<\/image_local_path>/gi, "")
    .replace(/^(?:Time sampled while preparing|Elapsed since the preceding|Browser time zone for this request)[^\n]*\n?/gim, "")
    .trim();
}


export function condenseUserPrompt(raw) {
  const base = cleanUserPrompt(raw);
  if (!base) return "";
  const lines = base.split("\n");
  let inFence = false;
  const cleaned = lines.map((line) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return line; }
    if (inFence) return line;
    let s = line.trim();
    if (!s) return "";
    // Remove leading spoken/courtesy fillers repeatedly until substantive text starts.
    const zhLead = /^(?:(?:你好|哈喽|嗨|请问(?:一下)?|麻烦(?:你)?|劳烦|请?帮我(?:先)?(?:看看|看一下|查一下)?|你(?:先|再)?(?:帮我)?(?:看看|看一下|查一下)|我想(?:问一下|让你|要)|能不能(?:帮我)?|可不可以(?:帮我)?|那个|就是说?|怎么说呢|其实吧|嗯+|啊+|呃+|额+|哦+|唉+|哎+|然后呢?)[，,、。\s:：]*)+/;
    const enLead = /^(?:(?:hey|hi|hello|um+|uh+|okay|ok|well|so|basically|actually|honestly|please|can you|could you|would you|help me)\b[\s,:-]*)+/i;
    let prev = "";
    while (s !== prev) {
      prev = s;
      s = s.replace(zhLead, "").replace(enLead, "").trim();
    }
    // Collapse pure hesitation interjections between clauses.
    s = s
      .replace(/[，,]\s*(?:嗯+|啊+|呃+|额+|那个|就是说?|怎么说呢|怎么讲|怎么说)\s*[，,]/g, "，")
      .replace(/\s+\b(?:um+|uh+|you know|basically|like)\b\s*,\s*/gi, ", ")
      .replace(/[，,、\s]*(?:谢谢(?:你|啦)?|多谢|麻烦了|辛苦了|好吗|可以吗|对吧|是吧|好吧|行吧)[！!。.?？\s]*$/, "")
      .replace(/([，,])\1+/g, "$1")
      .replace(/^[，,、\s]+/, "")
      .trim();
    return s || line.trim();
  }).filter((line, i, arr) => line || (i > 0 && arr[i - 1] !== ""));
  const joined = cleaned.join("\n").trim();
  return joined.length >= 2 || base.trim().length < 2 ? joined : base.trim();
}

// QwenWork 2.x prepends workspace rules, the awareness protocol and the lazy-load
// tool list to the first user message. Those blocks are engine context, not what
// the user typed, so they must not leak into the conversation view or the journal.
const QWEN_WORK_CONTEXT_BLOCK = /<(workspace_context|runtime_environment|system-reminder|system_reminder|skills_directory|unattended_task|host_context_checkpoint)\b[^>]*>[\s\S]*?<\/\1>/gi;
const QWEN_WORK_TOOL_LIST_START = /(?:^|\n\n)(?:Available MCP servers|Available tools):\n/;
const QWEN_WORK_TOOL_GUIDANCE_END = /(?:Do not guess aliases if a function is absent from the real tool list\.|Never call mcp__server__tool directly unless it is already exposed in the real tool list\.)/g;

export function stripQwenWorkContext(raw) {
  let s = String(raw || "").replace(QWEN_WORK_CONTEXT_BLOCK, "");
  const start = s.search(QWEN_WORK_TOOL_LIST_START);
  if (start >= 0) {
    const tail = s.slice(start);
    let end = 0;
    QWEN_WORK_TOOL_GUIDANCE_END.lastIndex = 0;
    for (let m; (m = QWEN_WORK_TOOL_GUIDANCE_END.exec(tail)); ) end = m.index + m[0].length;
    // The lazy-load list ends the block: "Available tools:\n<names on one line>".
    const listMarker = "\n\nAvailable tools:\n";
    const listAt = tail.lastIndexOf(listMarker);
    if (listAt >= 0) {
      const lineEnd = tail.indexOf("\n", listAt + listMarker.length);
      end = Math.max(end, lineEnd < 0 ? tail.length : lineEnd);
    }
    if (end > 0) s = s.slice(0, start) + tail.slice(end);
  }
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

export function isPromptText(text) {
  const s = cleanUserPrompt(text).trim();
  if (!s) return false;
  if (/^<(command-|local-command|system-reminder|task-notification|ci-monitor|environment_context)/.test(s)) return false;
  if (/^\[Request interrupted/.test(s)) return false;
  if (/^You are an AI agent powered by/.test(s)) return false;
  // Harness bookkeeping that ships alongside the prompt is not the task.
  if (/^(?:Time sampled while preparing|Elapsed since the preceding|Browser time zone for this request)/.test(s)) return false;
  // 新版 Codex 会把 AGENTS.md、打开的页面这些上下文当成用户消息塞在最前面，不是任务本身
  if (/^# AGENTS\.md instructions|^<(user_instructions|external_codex_)/.test(s)) return false;
  return true;
}
