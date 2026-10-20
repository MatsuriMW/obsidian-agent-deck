// node test/bind.test.mjs —— 拖拽绑定的纯文本部分
import * as J from "../src/journal.js";
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
process.exit(fail ? 1 : 0);
