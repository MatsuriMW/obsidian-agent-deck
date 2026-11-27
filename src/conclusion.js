// Agent Deck — 独立的任务结论总结层.
//
// 负责：配置与风格解析、长回复结构化压缩（折叠大段代码块与表格，保留头尾核心判断与状态）、
// 提示词模板构建（含自定义提示词与占位符替换）、模型输出解析与退化拦截、本地规则兜底，以及设置页样例试跑。
// 依赖严格单向：只引用 ./journal.js、./prompt-text.js、./llm.js，禁止反向引入。

import * as J from "./journal.js";
import { condenseUserPrompt } from "./prompt-text.js";
import { runJournalModel } from "./llm.js";

export const CONCLUSION_STYLES = {
  balanced: {
    id: "balanced",
    codeRule: "写清具体改了/做了什么（带关键对象、模块或文件名）以及当前验证/落地状态（已通过 / 待验证 / 失败或阻塞），禁止空洞套话",
    qaRule: "直接给出核心判断或答案本身，再补充 1 到 2 句关键依据或建议；禁止「分析了某问题」「解答了疑问」这类元描述",
    mergeRule: "先写已做成的核心成果与对象，再写当前验证状态或遗留卡点",
  },
  concise: {
    id: "concise",
    codeRule: "用高密度短语写清「动作与对象；当前状态」，去掉连接词与主语",
    qaRule: "用一句话高密度直述核心结论与依据，去掉铺垫与举例",
    mergeRule: "极简合并，只留核心成果、最终状态与阻塞项",
  },
  structured: {
    id: "structured",
    codeRule: "严格按「改动：…；结果：…；遗留：…（无遗留则省略第三段）」分号分隔输出，不遗漏未验证或失败项",
    qaRule: "严格按「结论：…；依据：…」分号分隔写清判断与核心理由",
    mergeRule: "按「成果：…；状态：…；待办：…（无则省略）」分号分隔总结",
  },
  custom: {
    id: "custom",
    codeRule: "按用户自定义模板提炼编码任务改动与验证状态",
    qaRule: "按用户自定义模板提炼核心判断与依据",
    mergeRule: "按用户自定义要求凝练多轮总结",
  },
};

export const DEFAULT_CUSTOM_CONCLUSION_PROMPT = [
  "请把下面这一轮人机协作提炼成高信息密度的任务结论，直接可用于工作日记：",
  "- 编码/操作类（kind=\"code\"，不超过 {{codeMax}} 字）：写清改了什么对象或模块、现在什么状态（已通过 / 待验证 / 失败卡点），不写「完成了修改」这类空话。",
  "- 问答/分析类（kind=\"qa\"，不超过 {{qaMax}} 字）：直接给核心判断与关键依据，不写「回答了关于…的问题」这类元描述。",
  "- 严禁编造未验证通过的结果，去掉开场寒暄和结尾客套。",
  '- 只输出 JSON：{"task":"任务要点（不超过 25 字）","result":"结论","kind":"code|qa"}',
  "",
  "【任务】",
  "{{task}}",
  "",
  "【AI 回复】",
  "{{reply}}",
].join("\n");

const DEGENERATE_RESULT_RE = /^(?:code|qa|json|ok|done|已完成|已修复|已更新|搞定了?|没有|无|null|undefined)[。！!.]*$/i;
const LEADING_LABEL_RE = /^(?:结论|总结|核心结论|一句话总结|结果)[：:]\s*/;

export function resolveConclusionConfig(cfg = {}) {
  const rawStyle = String(cfg.conclusionStyle || "balanced").trim();
  const style = Object.hasOwn(CONCLUSION_STYLES, rawStyle) ? rawStyle : "balanced";
  return {
    style,
    codeMax: Math.max(20, Math.min(400, Math.round(Number(cfg.conclusionMaxCode) || 90))),
    qaMax: Math.max(40, Math.min(800, Math.round(Number(cfg.conclusionMaxQA) || 200))),
    mergeMax: Math.max(60, Math.min(600, Math.round(Number(cfg.conclusionMaxMerge) || 180))),
    extraPrompt: String(cfg.summaryPrompt || "").trim(),
    customTemplate: String(cfg.conclusionPromptTemplate || "").trim(),
  };
}

function foldLongTables(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (/^\s*\|.*\|\s*$/.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) j++;
      if (j - i > 6) {
        out.push(lines[i], lines[i + 1], lines[i + 2], `（略 ${j - i - 4} 行表格）`, lines[j - 1]);
      } else {
        for (let k = i; k < j; k++) out.push(lines[k]);
      }
      i = j;
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
}

/** 压缩过长代码块与大表格，再按头尾采样，避免中间关键结论与末尾验证状态互相挤占。 */
export function prepareReplyForSummary(raw, { head = 900, tail = 1300 } = {}) {
  const source = String(raw || "");
  if (!source.trim()) return "";
  const codeFolded = source.replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g, (block) => {
    const chars = [...block];
    return chars.length > 180 ? "\n[代码块]\n" : block;
  });
  const tableFolded = foldLongTables(codeFolded)
    .replace(/\d{12,}/g, "…")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return J.sampleReplyForSummary(tableFolded, { head, tail });
}

/** 清理用户提问中的引擎注入上下文与多余空白，并按头尾预算采样。 */
export function prepareTaskForSummary(raw, { head = 500, tail = 300 } = {}) {
  const cleaned = condenseUserPrompt(raw || "").replace(/\d{12,}/g, "…").trim();
  if (!cleaned) return "";
  return J.sampleReplyForSummary(cleaned, { head, tail });
}

function stripCustomPlaceholders(tpl) {
  return String(tpl || "")
    .replace(/【(?:任务|AI\s*回复|回复)】\s*\{\{\s*(?:task|reply)\s*\}\}/g, "")
    .replace(/\{\{\s*(?:task|reply|codeMax|qaMax|mode)\s*\}\}/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** 生成嵌入 AutoLog 批量 JSON 数组提示词里的 summary 字段规则。 */
export function conclusionGuidanceForAutoLog(cfg = {}) {
  const { style, codeMax, qaMax, extraPrompt, customTemplate } = resolveConclusionConfig(cfg);
  const spec = CONCLUSION_STYLES[style];
  const lines = [
    `- summary：这一轮最后落在哪。kind=code 时不超过 ${codeMax} 个字，${spec.codeRule}；kind=qa 时不超过 ${qaMax} 个字，${spec.qaRule}。去掉口语铺垫，不编造未验证通过的结果；没有回复则填空字符串。`,
  ];
  if (style === "custom" && customTemplate) {
    const customInstr = stripCustomPlaceholders(customTemplate);
    if (customInstr) lines.push(`- 补充要求（用户自定义）：${customInstr.slice(0, 600)}`);
  }
  if (extraPrompt) lines.push(`- 补充要求（用户自定义）：${extraPrompt}`);
  return lines.join("\n");
}

/** 构建单轮结论润色提示词（支持预设风格与用户自定义完整模板）。 */
export function buildTurnConclusionPrompt({ ask = "", reply = "", mode = "brief", cfg = {} } = {}) {
  const conf = resolveConclusionConfig(cfg);
  const { style, codeMax, qaMax, extraPrompt, customTemplate } = conf;
  const taskSample = prepareTaskForSummary(ask, { head: 500, tail: 300 });
  const replySample = prepareReplyForSummary(reply, { head: 900, tail: 1300 });

  if (style === "custom") {
    const template = customTemplate || DEFAULT_CUSTOM_CONCLUSION_PROMPT;
    const hasReplySlot = /\{\{\s*reply\s*\}\}/.test(template);
    const hasTaskSlot = /\{\{\s*task\s*\}\}/.test(template);
    let rendered = template
      .replace(/\{\{\s*task\s*\}\}/g, taskSample || "（无）")
      .replace(/\{\{\s*reply\s*\}\}/g, replySample || "（无）")
      .replace(/\{\{\s*codeMax\s*\}\}/g, String(codeMax))
      .replace(/\{\{\s*qaMax\s*\}\}/g, String(qaMax))
      .replace(/\{\{\s*mode\s*\}\}/g, mode === "standard" ? "standard" : "brief");
    if (extraPrompt) rendered += `\n\n补充要求：${extraPrompt}`;
    if (!hasReplySlot) {
      const blocks = [];
      if (!hasTaskSlot && taskSample) blocks.push(`【任务】\n${taskSample}`);
      blocks.push(`【AI 回复】\n${replySample}`);
      rendered += `\n\n${blocks.join("\n\n")}`;
    }
    return rendered.trim();
  }

  const spec = CONCLUSION_STYLES[style];
  const brief = mode !== "standard";
  const codeTarget = style === "concise" ? Math.min(codeMax, Math.max(20, Math.round(codeMax * 0.72))) : Math.max(20, Math.round(codeMax * 0.82));
  const qaTarget = style === "concise" ? Math.min(qaMax, Math.max(40, Math.round(qaMax * 0.55))) : Math.max(40, Math.round(qaMax * 0.8));
  const commonBan = "仅根据下面提供的文本原文提炼，不要调用工具、不要尝试读取文件或提及工作区目录。严禁输出「分析了…」「解答了…」「完成了修改」「已处理」等空洞元描述，必须写出具体对象、结论与真实状态；不编造未验证的结论，去掉开场寒暄和结尾客套，不要代码块。务必在目标字数内完整收尾，绝不超字数被截断。";
  const header = brief
    ? `把本轮任务和回复分别浓缩成高信息密度的结果，只输出 JSON：{"task":"任务要点，最多 30 字","result":"结论要点","kind":"code|qa"}。`
      + `kind：这一轮在改代码、跑命令、动文件就填 code，result 严格不超过 ${codeMax} 字（建议 ${codeTarget} 字内写完），${spec.codeRule}；`
      + `这一轮在解释概念、回答知识问题或对比方案就填 qa，result 严格不超过 ${qaMax} 字（建议 ${qaTarget} 字内写完），${spec.qaRule}。${commonBan}`
    : `把下面 AI 助手这一轮的回复提炼成一条凝练结论，只输出 JSON：{"result":"结论","kind":"code|qa"}。`
      + `kind：改代码 / 跑命令 / 动文件填 code，result 严格不超过 ${codeMax} 字（建议 ${codeTarget} 字内写完），${spec.codeRule}；`
      + `解释概念、回答知识问题或对比方案填 qa，result 严格不超过 ${qaMax} 字（建议 ${qaTarget} 字内写完），${spec.qaRule}。${commonBan}`
      + `不要前缀、不要引号、不要代码块。`;

  return [
    header,
    extraPrompt ? `补充要求：${extraPrompt}` : "",
    brief && taskSample ? `任务：${taskSample}` : "",
    "",
    replySample,
  ].join("\n");
}

/** 构建多轮累积合并总结提示词。 */
export function buildMergeConclusionPrompt({ previous = "", rounds = [], cfg = {} } = {}) {
  const { style, mergeMax, extraPrompt } = resolveConclusionConfig(cfg);
  const spec = CONCLUSION_STYLES[style];
  const items = (Array.isArray(rounds) ? rounds : []).map((r) => {
    const content = prepareReplyForSummary(r.summary || r.said || "", { head: 300, tail: 500 });
    return content ? `第 ${r.n} 轮：${content}` : "";
  }).filter(Boolean);

  return [
    "把同一任务以下工作记录合并成 1 到 2 句完整的中文句子，写进日记直接当结论用。",
    "每句都要有主语和谓语，读起来是一句完整的话；不要「已完成」「搞定了」这种没有主语的碎片。",
    `${spec.mergeRule}；不要逐轮复述用户要求，也不要把没做完或失败的说成做完了。`,
    `不要前缀、不要引号、不要代码块，总长不超过 ${mergeMax} 字。只输出总结本身。`,
    extraPrompt ? `补充要求：${extraPrompt}` : "",
    previous ? `此前总结：${previous}` : "",
    ...items,
  ].filter(Boolean).join("\n");
}

function extractFirstJsonObject(raw) {
  const stripped = String(raw || "").replace(/^```(?:json)?\s*|\s*```$/gm, "").trim();
  if (!stripped) return null;
  try {
    const direct = JSON.parse(stripped);
    if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;
  } catch { /* 尝试从前后夹杂文字中抠出第一个平衡对象 */ }
  const start = stripped.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\" && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        const obj = JSON.parse(stripped.slice(start, i + 1));
        if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
      } catch { return null; }
      break;
    }
  }
  return null;
}

function isUsableResult(text) {
  const s = String(text || "").trim();
  return [...s].length >= 4 && !DEGENERATE_RESULT_RE.test(s);
}

/** 解析单轮结论模型返回，支持 JSON 对象与自定义提示词的纯文本输出，自动拦截退化短句。 */
export function parseConclusionResponse(raw, { mode = "brief", cfg = {}, allowPlainText = false } = {}) {
  const { style, codeMax, qaMax } = resolveConclusionConfig(cfg);
  const data = extractFirstJsonObject(raw);
  if (data) {
    const kind = data.kind === "qa" || data.kind === "code" ? data.kind : "";
    const limit = kind === "qa" ? qaMax : codeMax;
    const rawTask = typeof data.task === "string" ? data.task.trim() : "";
    const rawRes = typeof data.result === "string" ? data.result.trim() : (typeof data.summary === "string" ? data.summary.trim() : "");
    const task = rawTask ? J.summaryText(rawTask, 45) : "";
    const capped = isUsableResult(rawRes) ? J.summaryText(rawRes, limit).replace(/[；;，,]\s*…$/, "…") : "";
    return {
      kind,
      task: mode === "standard" ? "" : task,
      result: isUsableResult(capped) ? capped : "",
    };
  }
  if (allowPlainText || style === "custom") {
    const plain = String(raw || "")
      .replace(/^```[\w-]*\s*|\s*```$/gm, "")
      .replace(/^["'「『]|["'」』]$/g, "")
      .replace(LEADING_LABEL_RE, "")
      .trim();
    const limit = Math.max(codeMax, qaMax);
    const cleaned = isUsableResult(plain) ? J.summaryText(plain, limit) : "";
    return { kind: "", task: "", result: isUsableResult(cleaned) ? cleaned : "" };
  }
  return { kind: "", task: "", result: "" };
}

/** 本地规则兜底提取结论（模型未配置、超时或返回无效时使用）。 */
export function fallbackConclusion({ ask = "", said = "", kind = "", cfg = {} } = {}) {
  const { codeMax, qaMax } = resolveConclusionConfig(cfg);
  const resolvedKind = kind === "qa" || kind === "code" ? kind : J.conclusionKind(ask, said);
  const text = String(said || "").trim();
  const result = text
    ? (resolvedKind === "qa" ? J.answerConclusion(text, qaMax) : J.conclusionSentence(text, codeMax))
    : "";
  return { kind: resolvedKind, result };
}

/** 对单轮对话执行模型结论总结。 */
export async function summarizeTurn({ ask = "", reply = "", mode = "brief", cfg = {}, automatic = true, runModel = runJournalModel } = {}) {
  const { style } = resolveConclusionConfig(cfg);
  const prompt = buildTurnConclusionPrompt({ ask, reply, mode, cfg });
  const raw = await runModel(prompt, cfg, { polish: true, automatic });
  const parsed = parseConclusionResponse(raw, { mode, cfg, allowPlainText: style === "custom" });
  return { ...parsed, prompt, raw };
}

/** 对同一任务多轮记录执行模型累积总结。 */
export async function summarizeMerge({ previous = "", rounds = [], cfg = {}, automatic = true, runModel = runJournalModel } = {}) {
  const { mergeMax } = resolveConclusionConfig(cfg);
  const prompt = buildMergeConclusionPrompt({ previous, rounds, cfg });
  const raw = await runModel(prompt, cfg, { automatic });
  return { text: J.summaryText(raw, mergeMax), prompt, raw };
}

const PREVIEW_SAMPLE = {
  ask: "帮我修一下自动记录在标准模式下结论总被砍成 65 字、长回复只截末尾的问题，顺便检查热重载。",
  reply: [
    "先说问题根因：`src/sync.js` 在标准模式下误用了 `safeLabel(..., 65)` 把 QA 结论截成了 65 字，而且只取了回复最后 900 字，导致长回复开头的结论段丢失。",
    "",
    "已修改以下文件：",
    "- `src/conclusion.js`：抽出独立总结层，加入代码块/表格折叠与头尾双段采样。",
    "- `src/sync.js` / `src/autolog.js`：统一接入独立总结层并透传 `conclusionMaxCode` / `conclusionMaxQA`。",
    "",
    "验证结果：macOS 上 `npm test` 与 `npm run build` 全部通过，Obsidian 主库热重载无报错；Windows 真机 GUI 尚未实测。",
    "",
    "如果你需要我把这一版直接推到 GitHub 发版，告诉我一声就行。",
  ].join("\n"),
};

/** 设置页「用样例试跑总结」：用当前配置跑一遍真实模型，返回生成结论与耗时。 */
export async function previewConclusion(cfg = {}, { runModel = runJournalModel } = {}) {
  const mode = cfg.autoLogDetail === "standard" ? "standard" : "brief";
  const started = Date.now();
  const res = await summarizeTurn({
    ask: PREVIEW_SAMPLE.ask,
    reply: PREVIEW_SAMPLE.reply,
    mode,
    cfg,
    automatic: false,
    runModel,
  });
  return { ...res, mode, ms: Date.now() - started };
}
