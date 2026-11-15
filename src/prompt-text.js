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
