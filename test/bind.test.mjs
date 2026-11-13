// node test/bind.test.mjs —— 拖拽绑定、^xxxxx 块追踪、多轮合并与步骤追踪测试
import * as J from "../src/journal.js";
import { cleanUserPrompt, applyTaskTool, AgentUsage } from "../src/readers.js";
let fail = 0;
const check = (name, ok, out) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) { fail++; console.log(out); } };
const sid = "11111111-2222-3333-4444-555555555555";
const S = (o = {}) => ({ sid, agent: "claude", title: "卡片搬迁", state: "run", since: "20:10", ...o });

{ // 有序列表里的条目：原文保留，加 DOING 和 🔗 子块
  const t = "- 今天\n\t1. 做完卡片搬迁的功能\n\t2. 别的\n";
  const r = J.bindInto(t, 1, S());
  check("bind ordered item", r.text === "- 今天\n\t1. DOING 20:10 做完卡片搬迁的功能\n\t\t- 🔗 [Claude：卡片搬迁](claude://resume?session=" + sid + ")\n\t2. 别的\n", r.text);
}
{ // TODO 换成会话状态；等你 → TOREVIEW；已有子项跟着它的缩进
  const t = "- TODO 写周报\n    - 已有子项\n";
  const r = J.bindInto(t, 0, S({ state: "wait" }));
  check("TODO → TOREVIEW, child indent", r.text.startsWith("- TOREVIEW 20:10 写周报\n    - 🔗 "), r.text);
}
{ // 用户定的 PAUSED 不动
  const r = J.bindInto("- PAUSED 08:00 另一件\n", 0, S());
  check("PAUSED untouched", r.text.startsWith("- PAUSED 08:00 另一件\n\t- 🔗"), r.text);
}
{ // 空行：新建一项，接着上面的有序编号
  const t = "1. 第一件\n2. 第二件\n\n";
  const r = J.bindInto(t, 2, S());
  check("blank → new numbered item", r.text.split("\n")[2] === "3. DOING 20:10 🤖 卡片搬迁" && /^\t- 🔗/.test(r.text.split("\n")[3]), r.text);
}
{ // 空的列表项：就地写上
  const r = J.bindInto("- \n", 0, S({ state: "wait" }));
  check("empty item filled", r.text.startsWith("- TOREVIEW 20:10 🤖 卡片搬迁\n\t- 🔗"), r.text);
}
{ // 一对一：别处的 🔗 摘掉，自动记日记替它写的 🤖 项收掉
  const t = `- DOING 19:00 🤖 卡片搬迁\n\t- ⏱ 19:00–19:30 · 共 30m\n\t- 🔗 [Claude：卡片搬迁](claude://resume?session=${sid})\n- 做完卡片搬迁的功能\n`;
  const r = J.bindInto(t, 3, S({ dropKey: "🤖 卡片搬迁" }));
  check("moves binding, drops auto line", r.text === `- DOING 20:10 做完卡片搬迁的功能\n\t- 🔗 [Claude：卡片搬迁](claude://resume?session=${sid})\n`, r.text);
}
{ // 已经绑着别的会话：不动
  const t = "- 一件事\n\t- 🔗 [Claude：x](claude://resume?session=99999999-2222-3333-4444-555555555555)\n";
  check("refuse second binding", !!J.bindInto(t, 0, S()).error);
  check("drop on marker line binds owner", J.dropKind(t.split("\n"), 1).line === 0);
}
{ // Codex / WorkBuddy 链接认得出来
  const c = J.linkLine("\t", "codex", "x", "01a15933-7242-7a31-b036-38dca1dd898a");
  const w = J.linkLine("\t", "workbuddy", "y", "cda39538-78ec-46a5-a3ac-27d0acca1254");
  check("codex link parses", J.parseLink(c).agent === "codex" && J.parseLink(c).sid === "01a15933-7242-7a31-b036-38dca1dd898a", c);
  check("workbuddy link parses", J.parseLink(w).agent === "workbuddy", w);
  const d = J.linkLine("\t", "dsh", "z", "session-060721ce-1e59-41c4-ab73-181751881562");
  check("dsh link parses", J.parseLink(d) && J.parseLink(d).agent === "dsh" && J.parseLink(d).sid.startsWith("session-"), d);
}
{ // 段落下面新建；标题上不放
  const r = J.bindInto("一段话\n", 0, S());
  check("paragraph → item below", r.text.startsWith("一段话\n- DOING 20:10 🤖 卡片搬迁\n"), r.text);
  check("heading refused", !!J.bindInto("## 标题\n", 0, S()).error);
}
{ // 时段分钟数从日记分界（8 点）起算：写成钟点要加回来
  J.setDayOffset(8 * 60);
  check("clock adds day cutoff", J.clock(0) === "08:00" && J.clock(17 * 60 + 5) === "01:05", J.clock(0) + " " + J.clock(17 * 60 + 5));
  J.setDayOffset(0);
}
{ // 空行下面是一段文字：新项插在空行前，空行留着
  const r = J.bindInto("1. 第一件\n\n一段话\n", 1, S());
  const L = r.text.split("\n");
  check("blank before paragraph kept", L[1] === "2. DOING 20:10 🤖 卡片搬迁" && L[3] === "" && L[4] === "一段话", r.text);
}
{ // ⌘ 拖：不绑这一项，在它（连同子项）下面新建一项
  const t = "- 做完卡片搬迁的功能\n\t- 子项\n- 别的\n";
  const r = J.bindInto(t, 0, S(), { below: true });
  const L = r.text.split("\n");
  check("cmd-drop inserts after the block", L[0] === "- 做完卡片搬迁的功能" && L[1] === "\t- 子项" && L[2] === "- DOING 20:10 🤖 卡片搬迁" && /^\t- 🔗/.test(L[3]) && L[4] === "- 别的", r.text);
  const o = J.bindInto("1. 第一件\n2. 第二件\n", 0, S({ state: "wait" }), { below: true });
  check("cmd-drop numbers on", o.text.split("\n")[1] === "2. TOREVIEW 20:10 🤖 卡片搬迁", o.text);
}
{ // Antigravity 链接认得出来
  const a = J.linkLine("\t", "antigravity", "更新插件", "6b1017c0-f422-4366-bad2-1e29f1bbc7be");
  check("antigravity link parses", J.parseLink(a) && J.parseLink(a).agent === "antigravity" && J.parseLink(a).sid === "6b1017c0-f422-4366-bad2-1e29f1bbc7be", a);
}
{ // ^xxxxx 块 ID 追踪：哪怕改了任务文字，也能靠 ^ad-xxxxxx 找回同一个条目
  const id = J.makeBlockId(sid);
  const t = `- DOING 10:00 用户改名后的任务描述 ^${id}\n\t- 笔记子项\n`;
  const found = J.findTask(t, "原来的名字", id, sid);
  check("findTask by ^xxxxx blockId after rename", found && found.line === 0 && found.blockId === id, found);
}
{ // 一句话结论提取：去掉代码块和标题，抽出简洁的一句话
  const md = "## 修复报告\n```js\nconst x = 1;\n```\n- 排查了日志路径\n\n已完成 Agent Deck 与螺旋日程的 ^xxxxx 块级多轮追踪和合并支持。";
  const one = J.oneSentenceConclusion(md, 80);
  check("oneSentenceConclusion extracts final sentence", one === "已完成 Agent Deck 与螺旋日程的 ^xxxxx 块级多轮追踪和合并支持。", one);
}
{ // 同一个会话多轮对话（追问 ❓ + 每轮一句话结论 💬 + 待办 📋 + 用户拍板 TODO 🤖）都跟在同一个 ^xxxxx 条目下
  const t0 = "- DOING 14:00 升级 Agent Deck 插件\n";
  const r1 = J.syncSessionEntry(t0, {
    sid,
    key: "升级 Agent Deck 插件",
    detail: "detailed",
    said: "第一轮完成了基础日志解析。",
    rounds: [
      { n: 1, ask: "帮我升级 Agent Deck 插件", said: "第一轮完成了基础日志解析。" },
      { n: 2, ask: "加上 Claude TaskCreate 和对话轮数追踪", said: "已支持 Claude TaskCreate 与其他 Agent 轮数追踪。" },
    ],
    todos: ["确认是否启用混合模式润色"],
    taskTodo: { done: 2, total: 3, cur: "编写单元测试" },
    ensureId: true,
  });
  check("syncSessionEntry assigns ^xxxxx and keeps all turns under one entry",
    r1.blockId === "ad-111111" &&
    r1.text.includes("^ad-111111") &&
    r1.text.includes("\t- 📋 第2轮：步骤 2/3 · 编写单元测试") &&
    r1.text.includes("\t- 💬 第一轮完成了基础日志解析。") &&
    r1.text.includes("\t- ❓ 第2轮：加上 Claude TaskCreate 和对话轮数追踪") &&
    r1.text.includes("\t- 💬 第2轮：已支持 Claude TaskCreate 与其他 Agent 轮数追踪。") &&
    r1.text.includes("\t- TODO 🤖 确认是否启用混合模式润色") &&
    r1.text.split("\n").filter((l) => /^- /.test(l)).length === 1,
    r1.text
  );
}
{ // 条目合并/混合（J.mergeTasks）：把 🤖 自动记的条目合并到人写的条目下，保留人类标题与 ^xxxxx，搬运 💬/❓/🔗 子项并删掉重复项
  const t = [
    "- TODO 整理马自立库插件",
    "- DOING 15:20 🤖 更新 agent-deck 插件 ^ad-111111",
    "\t- 🔗 [Claude：更新插件](claude://resume?session=" + sid + ")",
    "\t- 💬 第1轮：已完成多轮追踪。",
    "\t- ❓ 第2轮：加上合并功能",
  ].join("\n") + "\n";
  const m = J.mergeTasks(t, 1, 0);
  check("mergeTasks merges auto task into human task",
    !m.error &&
    m.blockId === "ad-111111" &&
    m.text.startsWith("- DOING 15:20 整理马自立库插件 ^ad-111111\n") &&
    m.text.includes("\t- 🔗 [Claude：更新插件]") &&
    m.text.includes("\t- 💬 第1轮：已完成多轮追踪。") &&
    m.text.includes("\t- ❓ 第2轮：加上合并功能") &&
    !m.text.includes("🤖 更新 agent-deck 插件"),
    m.text
  );
}
{ // Claude TaskCreate / TaskUpdate 追踪 & WorkBuddy / Antigravity 清洗与轮数统计
  const fc = {};
  applyTaskTool(fc, "TaskCreate", { subject: "支持 ^xxxxx 追踪", activeForm: "正在支持 ^xxxxx 追踪" }, "c1");
  applyTaskTool(fc, "TaskCreate", { subject: "支持 Antigravity", activeForm: "正在支持 Antigravity" }, "c2");
  applyTaskTool(fc, "TaskCreate", { subject: "支持 ^xxxxx 追踪", activeForm: "正在支持 ^xxxxx 追踪" }, "c1"); // duplicate callId ignored
  const td1 = applyTaskTool(fc, "TaskUpdate", { taskId: "1", status: "completed" });
  const td2 = applyTaskTool(fc, "TaskUpdate", { taskId: "2", status: "in_progress" });
  check("Claude TaskCreate/TaskUpdate tracks done/total/cur", td2.done === 1 && td2.total === 2 && td2.cur === "正在支持 Antigravity", td2);

  const wbRaw = '<system-reminder data-role="user-context">cwd: /tmp</system-reminder>\n<user_query>\n帮我优化 WorkBuddy 标题提取\n</user_query>';
  check("cleanUserPrompt extracts WorkBuddy <user_query>", cleanUserPrompt(wbRaw) === "帮我优化 WorkBuddy 标题提取", cleanUserPrompt(wbRaw));

  const agRaw = "<USER_REQUEST>\n帮我支持 Antigravity 会话追踪\n</USER_REQUEST>";
  check("cleanUserPrompt extracts Antigravity <USER_REQUEST>", cleanUserPrompt(agRaw) === "帮我支持 Antigravity 会话追踪", cleanUserPrompt(agRaw));
}

{ // Existing records survive detail changes, including manual notes and nested records.
  const input = "- DOING 整理插件 ^ad-detail\n\t- 手写说明\n\t- 💬 旧结论\n\t- ❓ 第2轮：旧追问\n\t- 💬 第2轮：旧结论\n\t- 📋 步骤 1/2\n\t- TODO 用户子任务\n\t\t- 💬 子任务的手写记录\n";
  const rounds=[{n:1,ask:"原问题",said:"原回答"},{n:2,ask:"第二轮问题",said:"第二轮回答"}];
  for(const detail of ["brief","standard","detailed"]){
    check(`${detail} leaves saved rounds byte-for-byte`,J.syncSessionEntry(input,{blockId:"ad-detail",rounds,detail,granularity:"round"}).text===input);
  }
  check("missing source rounds do not erase historical prompts",J.syncSessionEntry(input,{blockId:"ad-detail"}).text===input);
}

process.exit(fail ? 1 : 0);
