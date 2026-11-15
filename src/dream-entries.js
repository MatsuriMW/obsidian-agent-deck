// Shared Dreaming memory entry parsing and path validation.
import { createHash } from "crypto";
import { t } from "./i18n.js";

export const MEMORY_LABELS = {
  fact: "事实",
  preference: "偏好",
  pattern: "待验证规律",
  lesson: "项目经验",
};

const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 24);

export const memoryId = (text) => "m-" + hash(text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ""));

export function notePath(value) {
  const p = String(value || "").trim().replace(/\\/g, "/");
  if (!p || p.startsWith("/") || /^[a-z]:/i.test(p) || p.split("/").some((x) => !x || x === "." || x === "..") || !p.endsWith(".md")) {
    throw new Error(t("记忆路径必须是库内的 .md 文件路径"));
  }
  return p;
}

export function memoryEntries(text) {
  const lines = String(text || "").split("\n");
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^- \*\*(事实|偏好|待验证规律|项目经验)\*\*：(.+?)(?: \^(dream-[a-f0-9]+))?$/.exec(lines[i]);
    if (!m) continue;
    let end = i + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
    const body = lines.slice(i, end).join("\n");
    const state = /\n  - 状态：(已拒绝|已被替代)/.exec(body)?.[1] || "有效";
    entries.push({
      id: m[3] ? "m-" + m[3].slice(6) : memoryId(m[2]),
      text: m[2],
      kind: Object.keys(MEMORY_LABELS).find((k) => MEMORY_LABELS[k] === m[1]),
      state,
      line: i,
      end,
      body,
    });
    i = end - 1;
  }
  return entries;
}
