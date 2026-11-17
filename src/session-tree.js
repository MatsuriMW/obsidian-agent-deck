// 会话卡片的父子树：只用来排顺序和缩进，不参与统计与派发。
//
// 规则（与卡片任务 5 的口径一致）：
//   · 父会话就在同一份列表里 → 子卡排在父卡后面，按层级缩进；
//   · 父会话不在列表里（列表按 agent/项目分过组，或父已归档）→ 子卡留在顶层，不假装有父；
//   · 环（A 的父是 B、B 的父是 A）→ 都不嵌套，按原顺序当顶层，卡片一条都不许丢。

export const keyOfSession = (s) => String(s?.sid || "");
export const parentOfSession = (s) => String(s?.parentSid || "");

// 返回 { order, depth }：order 是整份列表里的先序序号（用于把子卡挪到父卡后面），depth 是缩进层级。
export function treePlan(items = [], keyOf = keyOfSession, parentOf = parentOfSession) {
  const rows = (items || []).filter((s) => keyOf(s));
  const byKey = new Map(rows.map((s) => [keyOf(s), s]));
  const children = new Map();
  const roots = [];
  for (const s of rows) {
    const key = keyOf(s), parent = parentOf(s);
    // 自己是自己的父，或父不在列表里：当顶层。
    if (!parent || parent === key || !byKey.has(parent)) { roots.push(s); continue; }
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(s);
  }
  const order = new Map(), depth = new Map();
  let next = 0;
  const walk = (s, level) => {
    const key = keyOf(s);
    order.set(key, next++);
    depth.set(key, level);
    for (const child of children.get(key) || []) if (!order.has(keyOf(child))) walk(child, level + 1);
  };
  for (const s of roots) if (!order.has(keyOf(s))) walk(s, 0);
  // 纯环：没有任何节点能当根，剩下的按原顺序铺平，保证每条都在。
  for (const s of rows) if (!order.has(keyOf(s))) walk(s, 0);
  return { order, depth };
}

// 按树的先序排列一份分好组的列表；不在计划里的（理论上不会有）排到最后。
export function treeOrder(items = [], plan, keyOf = keyOfSession) {
  const at = (s) => (plan?.order.has(keyOf(s)) ? plan.order.get(keyOf(s)) : Number.MAX_SAFE_INTEGER);
  return [...(items || [])].sort((a, b) => at(a) - at(b));
}
