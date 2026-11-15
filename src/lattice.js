// 自研 3×3 点阵等待动画组件，颜色继承 currentColor，尺寸由 styles.css 中的 --ad-ll-cell / --ad-ll-gap 控制。

const MODES = {
  orbit: { steps: [0, 1, 2, 7, -1, 3, 6, 5, 4], period: 9 },
  ripple: { steps: [2, 1, 2, 1, 0, 1, 2, 1, 2], period: 6 },
  snake: { steps: [0, 1, 2, 5, 4, 3, 6, 7, 8], period: 10 },
  arrow: { steps: [0, 1, 2, 0, 1, 2, 0, 1, 2], period: 5 },
};

/**
 * 在 parent 下渲染一个 3×3 点阵加载指示器。
 * @param {HTMLElement} parent
 * @param {"orbit"|"ripple"|"snake"|"arrow"} [pattern="orbit"]
 * @param {{ step?: number, cls?: string }} [opts]
 * @returns {HTMLSpanElement}
 */
export function lattice(parent, pattern = "orbit", { step = 95, cls = "" } = {}) {
  const mode = MODES[pattern] || MODES.orbit;
  const el = document.createElement("span");
  el.className = cls ? `ad-lattice ${cls}` : "ad-lattice";
  el.setAttribute("aria-hidden", "true");
  el.style.setProperty("--ad-ll-cycle", `${mode.period * step}ms`);

  for (const idx of mode.steps) {
    const dot = document.createElement("span");
    dot.className = "ad-lattice__cell";
    if (idx < 0) dot.dataset.hole = "";
    else dot.style.animationDelay = `${idx * step}ms`;
    el.appendChild(dot);
  }
  parent.appendChild(el);
  return el;
}
