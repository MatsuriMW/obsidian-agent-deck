import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => "en" };
const en = await import("../src/i18n.js?lang=en");
assert.equal(en.isZh, false);
assert.equal(en.t("设置"), "Settings");
assert.equal(en.t("{n} 个在跑", { n: 2 }), "2 running");
assert.equal(en.t("未翻译的键"), "未翻译的键");

globalThis.localStorage = { getItem: () => "zh-CN" };
const zh = await import("../src/i18n.js?lang=zh");
assert.equal(zh.isZh, true);
assert.equal(zh.t("设置"), "设置");
assert.equal(zh.t("{n} 个在跑", { n: 2 }), "2 个在跑");

console.log("PASS i18n en/zh");
