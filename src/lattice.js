// Lattice loader：一小格点阵按波次亮起，用在「准备中 / 委派中 / 在跑」这些等待态上。
// 移植自 React Bits 的 Lattice Loader（https://reactbits.dev/c/micro/lattice-loader），改成原生 DOM，只留点阵本身。
// Copyright (c) 2026 David Haz — MIT + Commons Clause（可以作为应用的一部分使用，不能单独再分发这个组件）。

// cells：每格第几拍亮起（null 是空位）；loop：一圈几拍；scale：拍长倍数；lit：一圈里亮着的占比
const PATTERNS = {
  orbit: { cells: [0, 1, 2, 7, null, 3, 6, 5, 4], loop: 8, scale: 1.2, lit: 0.62 },
  ripple: { cells: [2, 1, 2, 1, 0, 1, 2, 1, 2], loop: 4.8, scale: 1.5, lit: 0.62 },
  snake: { cells: [0, 1, 2, 5, 4, 3, 6, 7, 8], loop: 9, scale: 1, lit: 0.35 },
  arrow: { cells: [1, 2, 3, 0, 1, 2, 1, 2, 3], loop: 7.2, scale: 1, lit: 0.62 },
};

// 在 parent 里放一个点阵，返回这个元素。颜色跟 currentColor，尺寸用 CSS 变量 --ad-ll-cell / --ad-ll-gap 调
export function lattice(parent, pattern = "orbit", { step = 90, cls = "" } = {}) {
  const pat = PATTERNS[pattern] || PATTERNS.orbit;
  const d = step * pat.scale;
  const el = document.createElement("span");
  el.className = "ad-lattice" + (cls ? " " + cls : "");
  el.setAttribute("aria-hidden", "true");
  el.style.setProperty("--ad-ll-cycle", `${Math.round(pat.loop * d)}ms`);
  for (const unit of pat.cells) {
    const c = document.createElement("span");
    c.className = "ad-lattice__cell";
    if (unit == null) c.dataset.hole = "";
    else {
      c.style.animationDelay = `${Math.round(unit * d)}ms`;
      if (pat.lit !== 0.62) c.dataset.lit = String(Math.round(pat.lit * 100));
    }
    el.appendChild(c);
  }
  parent.appendChild(el);
  return el;
}
