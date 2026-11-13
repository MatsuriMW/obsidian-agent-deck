// Guards the strings the user actually sees when something goes wrong.
//
// test/i18n.test.mjs only checks t("…") call sites, so a notice, a thrown error
// or a status message written as a bare Chinese literal slips through and shows
// Chinese to an English UI. This walks those call shapes and requires the
// literal to be wrapped in t().

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const srcDir = path.join(root, "src");
const CJK = /[\u4e00-\u9fff]/;

// Places where a string is shown to the user rather than written to a note or
// sent to a model. The literal must be the argument of t(…).
const SHAPES = [
  // notice("…") / new Notice("…") — first argument
  { name: "notice", re: /(?<![\w$])(?:notice|Notice)\s*\(\s*/g },
  // throw new Error("…")
  { name: "throw", re: /throw\s+new\s+Error\s*\(\s*/g },
  // this.finish("error", "…") — second argument
  { name: "finish", re: /\bfinish\s*\(\s*["'][a-z]+["']\s*,\s*/g },
  // { error: "…" } / { err: "…" } / message: "…" returned to the caller
  { name: "field", re: /(?<![\w$])(?:error|err|message|reason)\s*:\s*/g },
];

const offenders = [];

function check(file, text) {
  // Blank comments out but keep offsets so the report keeps real line numbers.
  const clean = text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length));

  for (const { name, re } of SHAPES) {
    for (const match of clean.matchAll(re)) {
      const at = match.index + match[0].length;
      const rest = clean.slice(at, at + 400);
      // A literal, not an identifier or a call.
      if (!/^(["'`])/.test(rest)) continue;
      // Inside an open t(…) call is exactly what we want. The window is short
      // on purpose: t(({ … })[state] || "空闲") puts an object in between.
      const head = clean.slice(Math.max(0, match.index - 400), at);
      if (/t\([^)]*$/.test(head)) continue;
      const quote = rest[0];
      const end = rest.indexOf(quote, 1);
      if (end < 0) continue;
      const literal = rest.slice(1, end);
      if (!CJK.test(literal)) continue;
      const line = clean.slice(0, at).split("\n").length;
      offenders.push(`${file}:${line} [${name}] ${literal.slice(0, 60)}`);
    }
  }
}

for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith(".js"))) {
  check(file, fs.readFileSync(path.join(srcDir, file), "utf8"));
}

assert.equal(
  offenders.length,
  0,
  `user-facing Chinese strings that bypass t():\n  ${offenders.join("\n  ")}`,
);

console.log("PASS user-facing strings: every notice, thrown error and status message goes through t()");
