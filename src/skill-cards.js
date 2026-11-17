// 技能卡：把外部 Skill（目录 + SKILL.md）映射成库里的一篇 Markdown，
// 让人能双链找到、能被委派时指定；真实路径记在 frontmatter，不搬文件、不做软链。
import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";

export const SKILL_DIR = "技能";

export function skillRoots(home = os.homedir()) {
  return [path.join(home, ".config/skillshare/skills/data"), path.join(home, ".dsh/skills"), path.join(home, ".claude/skills")];
}

function readFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(String(text || ""));
  if (!m) return {};
  const out = {};
  const lines = m[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const hit = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!hit) continue;
    let value = hit[2].trim();
    // YAML 块标量（`>` / `|`）或留空的键：把后面的缩进行收进来。
    if (value === "" || value === ">" || value === "|") {
      const parts = [];
      let j = i + 1;
      while (j < lines.length && (/^\s+/.test(lines[j]) || !lines[j].trim())) { if (lines[j].trim()) parts.push(lines[j].trim()); j++; }
      value = parts.join(" ").trim();
      i = j - 1;
    }
    out[hit[1]] = value;
  }
  return out;
}

export function describeSkill(text) {
  const fm = readFrontmatter(text);
  const name = (fm.name || "").replace(/^["']|["']$/g, "");
  let description = (fm.description || "").replace(/^[>|]\s*/, "").trim();
  const lines = [];
  const body = String(text || "");
  if (!description) {
    const after = body.replace(/^---[\s\S]*?\n---/, "").trim().split("\n");
    description = after.find((l) => l.trim() && !l.startsWith("#"))?.trim() || "";
  }
  for (const line of description.split(/\s{2,}|\n/)) if (line.trim()) lines.push(line.trim());
  return { name, description: lines.join(" ").slice(0, 300) };
}

// 扫真实目录，按 realpath 去重（skillshare 常常把同一份技能挂到多个 agent 目录）。
export function scanSkills(roots = skillRoots()) {
  const seen = new Map();
  for (const root of roots) {
    let names = [];
    try { names = fs.readdirSync(root); } catch { continue; }
    for (const name of names) {
      const dir = path.join(root, name);
      const file = path.join(dir, "SKILL.md");
      let text = "";
      try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
      const real = fs.realpathSync(dir);
      if (seen.has(real)) continue;
      const meta = describeSkill(text);
      seen.set(real, { name: meta.name || name, dir, real, file, description: meta.description, source: root.includes("skillshare") ? "skillshare" : root.includes(".dsh") ? "dsh" : "claude" });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const bodyHash = (text) => createHash("sha256").update(String(text || "").replace(/^\n+/, "")).digest("hex").slice(0, 12);

// 拆成 frontmatter 与正文，用来判断"人有没有改过正文"。
export function splitCard(raw) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(String(raw || ""));
  return m ? { fm: m[1], body: m[2], head: `---\n${m[1]}\n---\n` } : { fm: "", body: String(raw || ""), head: "" };
}

export function skillCardMarkdown(skill, at = new Date().toISOString().slice(0, 10)) {
  const body = [
    `# ${skill.name}`,
    "",
    skill.description || "（SKILL.md 里没有描述）",
    "",
    "## 怎么用",
    "",
    "- 委派时：在派发草稿 frontmatter 写 `skill: \"[[技能/" + skill.name + "]]\"`，或直接在任务行里写这个双链。",
    "- Agent 拿到的是上面的 `path`，由它自己去读——技能内容不塞进 prompt。",
    "",
  ].join("\n");
  return [
    "---",
    "type: 技能",
    `skill: ${JSON.stringify(skill.name)}`,
    `path: ${JSON.stringify(skill.file)}`,
    `dir: ${JSON.stringify(skill.real)}`,
    `source: ${skill.source}`,
    `synced_at: ${at}`,
    `body_hash: ${bodyHash(body)}`,
    "---",
    "",
    body,
  ].join("\n");
}

// 人改过正文就不再覆盖；上游路径/来源仍然刷新，并标 edited 让你知道它被手改过。
export function nextCardContent(skill, existingRaw, at) {
  const { fm, body } = splitCard(existingRaw);
  const keptBody = body.replace(/^\n+/, "");
  const stored = (/^body_hash:\s*(\S+)$/m.exec(fm) || [])[1] || "";
  const edited = Boolean(stored) && bodyHash(body) !== stored;
  const regenerated = skillCardMarkdown(skill, at);
  if (!edited) return { content: regenerated, edited: false };
  const fmLines = [
    "---",
    "type: 技能",
    `skill: ${JSON.stringify(skill.name)}`,
    `path: ${JSON.stringify(skill.file)}`,
    `dir: ${JSON.stringify(skill.real)}`,
    `source: ${skill.source}`,
    `synced_at: ${at}`,
    `body_hash: ${stored}`,
    "edited: true",
    "---",
    "",
  ];
  return { content: `${fmLines.join("\n")}\n${keptBody}`, edited: true };
}

export function skillIndexMarkdown(skills = []) {
  const rows = skills.map((s) => `| [[技能/${s.name}\\|${s.name}]] | ${s.source} | ${(s.description || "").slice(0, 60)} |`);
  return ["# 技能索引", "", `共 ${skills.length} 个技能。点名字进卡片，卡片里记着真实路径。`, "", "| 技能 | 来源 | 一句话 |", "|---|---|---|", ...rows, ""].join("\n");
}

// 从文本里找 [[技能/xxx]]；草稿 frontmatter 的 skill: 字段优先。
export function skillRefIn(text) {
  const fm = readFrontmatter(text);
  const direct = /\[\[技能\/([^\]|]+)/.exec(fm.skill || "");
  if (direct) return direct[1].trim();
  const any = /\[\[技能\/([^\]|]+)/.exec(String(text || ""));
  return any ? any[1].trim() : "";
}

export function cardPathOf(text) {
  const fm = readFrontmatter(text);
  return (fm.path || "").replace(/^["']|["']$/g, "");
}
