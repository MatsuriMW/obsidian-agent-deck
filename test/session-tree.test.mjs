import test from "node:test";
import assert from "node:assert/strict";
import { treePlan, treeOrder } from "../src/session-tree.js";

const s = (sid, parentSid = "") => ({ sid, parentSid });

test("构树：子卡排在父卡后面，层级按嵌套算", () => {
  const rows = [s("a"), s("b", "a"), s("c", "b"), s("d")];
  const plan = treePlan(rows);
  assert.deepEqual(treeOrder(rows, plan).map((x) => x.sid), ["a", "b", "c", "d"], "先序：父→子→孙，再下一个根");
  assert.deepEqual([...plan.depth].sort(), [["a", 0], ["b", 1], ["c", 2], ["d", 0]].sort());
});

test("乱序输入也能把子卡挪到父卡后面，兄弟保持入参顺序", () => {
  const rows = [s("child1", "p"), s("p"), s("child2", "p"), s("other")];
  const plan = treePlan(rows);
  assert.deepEqual(treeOrder(rows, plan).map((x) => x.sid), ["p", "child1", "child2", "other"]);
});

test("孤儿：父不在列表里就留在顶层，不缩进、不丢卡", () => {
  const rows = [s("x", "已归档的父"), s("y")];
  const plan = treePlan(rows);
  assert.equal(plan.depth.get("x"), 0, "父不在列表 → 顶层");
  assert.deepEqual(treeOrder(rows, plan).map((x) => x.sid), ["x", "y"]);
});

test("环安全：A↔B 互相当父，只展开一次、深度有限、卡片都在", () => {
  const rows = [s("a", "b"), s("b", "a"), s("c")];
  const plan = treePlan(rows);
  assert.equal(treeOrder(rows, plan).length, 3, "三张卡一条不少");
  assert.equal(plan.depth.get("a"), 0, "环里第一个当根");
  assert.ok(plan.depth.get("b") <= 1, "环不展开成无限层级");
  assert.equal(plan.depth.get("c"), 0);
});

test("三节点环 + 正常父子混在一起：正常的仍按层级，环里的铺平", () => {
  const rows = [s("p"), s("k", "p"), s("x", "y"), s("y", "z"), s("z", "x")];
  const plan = treePlan(rows);
  const ordered = treeOrder(rows, plan).map((x) => x.sid);
  assert.equal(ordered.slice(0, 2).join(","), "p,k");
  assert.equal(new Set(ordered).size, 5);
  assert.equal(plan.depth.get("k"), 1);
});

test("重复 sid 与空 sid 不会把计划弄坏", () => {
  const rows = [s("a"), s("a"), s(""), s("b", "")];
  const plan = treePlan(rows);
  assert.equal(plan.order.size, 2, "只记两条有 sid 的");
  assert.equal(treeOrder(rows, plan).length, 4, "排序不丢条目");
});
