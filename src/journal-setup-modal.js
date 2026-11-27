import * as obsidianNs from "obsidian";
const { Modal } = obsidianNs;
const FuzzySuggestModalBase = obsidianNs.FuzzySuggestModal || Modal;
import { t } from "./i18n.js";
import {
  normalizeJournalPolicy,
  detectObsidianDailyTemplate,
  resolveVaultTemplateFile,
  extractTemplateHeadings,
  hasAiPlaceholder,
  getSharedJournalPromptState,
} from "./journal-policy.js";

export class VaultMarkdownPickerModal extends FuzzySuggestModalBase {
  constructor(app, onChoose) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder(t("输入模板笔记路径或文件名…"));
  }
  getItems() {
    const files = this.app?.vault?.getMarkdownFiles?.() || [];
    return [...files].sort((a, b) => a.path.localeCompare(b.path));
  }
  getItemText(file) {
    return file.path;
  }
  onChooseItem(file) {
    this.onChoose?.(file);
  }
}

export class JournalSetupModal extends Modal {
  constructor(app, plugin, { day = "", targetPath = "", caller = "agent-deck", initialPolicy = null, onResolve = null } = {}) {
    super(app);
    this.plugin = plugin;
    this.day = day;
    this.targetPath = targetPath;
    this.caller = caller;
    this.onResolve = onResolve;
    this._settled = false;
    this._userPickedPlacement = false;
    this._headings = [];
    this._hasAiToken = false;
    this._headingsReq = 0;

    const basePolicy = initialPolicy || plugin?.getJournalPolicy?.() || {};
    this.state = normalizeJournalPolicy(basePolicy, {
      legacyAutoCreate: plugin?.settings?.journalAutoCreate !== false,
    });
    if (this.state.configured && basePolicy?.aiPlacement) this._userPickedPlacement = true;
  }

  onOpen() {
    this.modalEl?.addClass?.("ad-modal", "ad-jsetup");
    this.render();
    this.refreshTemplateHints();
  }

  onClose() {
    this.contentEl.empty();
    if (!this._settled) {
      this._settled = true;
      const shared = getSharedJournalPromptState(this.app);
      if (this.day) shared.dismissedDay = this.day;
      this.onResolve?.({ saved: false, dismissed: true });
    }
  }

  settle(result) {
    if (this._settled) return;
    this._settled = true;
    this.onResolve?.(result);
    this.close();
  }

  async refreshTemplateHints({ autoSuggestPlaceholder = true } = {}) {
    const req = ++this._headingsReq;
    let raw = "";
    if (this.state.templateSource === "custom") {
      raw = this.state.templateText || "";
    } else if (this.state.templateSource === "file" || this.state.templateSource === "obsidian") {
      const path = this.state.templateSource === "file"
        ? this.state.templatePath
        : detectObsidianDailyTemplate(this.app);
      const file = path ? resolveVaultTemplateFile(this.app, path) : null;
      if (file) {
        try { raw = await this.app.vault.read(file); } catch { raw = ""; }
      }
    }
    if (req !== this._headingsReq) return;
    this._headings = extractTemplateHeadings(raw);
    this._hasAiToken = hasAiPlaceholder(raw);
    if (autoSuggestPlaceholder && !this._userPickedPlacement && this.state.mode === "auto") {
      if (this._hasAiToken) this.state.aiPlacement = "placeholder";
      else if (this.state.aiPlacement === "placeholder") this.state.aiPlacement = "bottom";
    }
    this.renderPlacementOptions();
  }

  render() {
    const el = this.contentEl;
    el.empty();

    const hasSpiral = !!this.app?.plugins?.plugins?.["nautilus-spiral"];
    const obsTpl = detectObsidianDailyTemplate(this.app);

    const head = el.createDiv({ cls: "ad-modalhead" });
    head.createDiv({ cls: "ad-modalhead__title", text: t("今日日记还未创建") });
    head.createDiv({
      cls: "ad-jsetup__why",
      text: hasSpiral
        ? t("螺旋日程用今日日记规划时间轴，Agent Deck 用它自动记录 AI 会话与结论。设好一次后，两款插件会共用这套规则，以后随时可在设置里修改。")
        : t("Agent Deck 需要今日日记来自动记录 AI 会话、任务进度与结论。设好一次后后续将自动沿用，以后随时可在设置里修改。"),
    });
    if (this.targetPath) {
      head.createDiv({ cls: "ad-jsetup__path", text: t("今日日记路径：{path}", { path: this.targetPath }) });
    }

    // 1. 创建方式
    const modeSec = el.createDiv({ cls: "ad-jsetup__sec" });
    modeSec.createDiv({ cls: "ad-jsetup__label", text: t("1. 今天没有日记时怎么做？") });
    const modeGrid = modeSec.createDiv({ cls: "ad-jsetup__choices" });

    const addModeCard = (mode, title, desc) => {
      const btn = modeGrid.createEl("button", {
        cls: "ad-jsetup__choice" + (this.state.mode === mode ? " is-on" : ""),
        attr: { type: "button", "aria-pressed": String(this.state.mode === mode) },
      });
      btn.createDiv({ cls: "ad-jsetup__choice-title", text: title });
      btn.createDiv({ cls: "ad-jsetup__choice-desc", text: desc });
      btn.onclick = () => {
        if (this.state.mode === mode) return;
        this.state.mode = mode;
        this.render();
        this.refreshTemplateHints();
      };
    };

    addModeCard("auto", t("帮我自动新建"), t("按下方选定的模板创建今日日记"));
    addModeCard("manual", t("我自己手动新建"), t("不抢先建文件，等你手动或用 Templater 建好后再自动写入"));

    // 2. 模板选择（仅自动新建时显示）
    if (this.state.mode === "auto") {
      const tplSec = el.createDiv({ cls: "ad-jsetup__sec" });
      tplSec.createDiv({ cls: "ad-jsetup__label", text: t("2. 新建日记时套用什么模板？") });
      const tabs = tplSec.createDiv({ cls: "ad-seg ad-jsetup__seg" });
      const tplOpts = [
        ["obsidian", obsTpl ? t("Obsidian 模板（{name}）", { name: obsTpl }) : t("Obsidian 模板（未配置）")],
        ["file", t("选库内文件")],
        ["custom", t("手动输入模板")],
        ["none", t("空白日记")],
      ];
      for (const [id, label] of tplOpts) {
        const b = tabs.createEl("button", {
          cls: "ad-seg__btn" + (this.state.templateSource === id ? " is-on" : ""),
          text: label,
          attr: { type: "button", "aria-pressed": String(this.state.templateSource === id) },
        });
        b.onclick = () => {
          this.state.templateSource = id;
          this.render();
          this.refreshTemplateHints();
        };
      }

      if (this.state.templateSource === "obsidian") {
        tplSec.createDiv({
          cls: "ad-jsetup__hint",
          text: obsTpl
            ? t("将读取模板「{path}」并展开 {{date}}、{{time}}、{{title}}。", { path: obsTpl })
            : t("未检测到 Obsidian 核心「日记」或 Periodic Notes 模板，将按默认格式新建。"),
        });
      } else if (this.state.templateSource === "file") {
        const row = tplSec.createDiv({ cls: "ad-jsetup__filerow" });
        const input = row.createEl("input", {
          cls: "ad-input",
          type: "text",
          value: this.state.templatePath,
          attr: { placeholder: t("输入库内模板路径，如：Templates/Daily.md") },
        });
        input.oninput = () => {
          this.state.templatePath = input.value.trim();
          this.refreshTemplateHints({ autoSuggestPlaceholder: false });
        };
        const pickBtn = row.createEl("button", { cls: "ad-btn", text: t("选择文件"), attr: { type: "button" } });
        pickBtn.onclick = () => {
          new VaultMarkdownPickerModal(this.app, (file) => {
            this.state.templatePath = file.path;
            this.render();
            this.refreshTemplateHints();
          }).open();
        };
      } else if (this.state.templateSource === "custom") {
        const placeholderText = t("例如：用 YAML 属性头、## 今日计划 与 {{ai}} 占位标记自定义模板");
        const ta = tplSec.createEl("textarea", {
          cls: "ad-textarea ad-jsetup__textarea",
          attr: {
            rows: "5",
            placeholder: placeholderText,
          },
        });
        ta.value = this.state.templateText || "";
        ta.oninput = () => {
          this.state.templateText = ta.value;
          this.refreshTemplateHints({ autoSuggestPlaceholder: false });
        };
        tplSec.createDiv({
          cls: "ad-jsetup__hint",
          text: t("支持 {{title}}、{{date}}、{{date:YYYY-MM-DD}}、{{time}}，写一行 {{ai}} 可精确指定 AI 自动记录区域位置。"),
        });
      }
    }

    // 3. AI 自动记录区域位置（auto 和 manual 都展示，manual 下提示轻量用途）
    this._placeSec = el.createDiv({
      cls: "ad-jsetup__sec" + (this.state.mode === "manual" ? " ad-jsetup__sec--quiet" : ""),
    });
    this.renderPlacementOptions();

    // Footer
    const foot = el.createDiv({ cls: "ad-modalfoot" });
    const laterBtn = foot.createEl("button", { cls: "ad-btn", text: t("今天先不建"), attr: { type: "button" } });
    laterBtn.onclick = () => {
      const shared = getSharedJournalPromptState(this.app);
      if (this.day) shared.dismissedDay = this.day;
      this.settle({ saved: false, dismissed: true });
    };

    const okBtn = foot.createEl("button", {
      cls: "ad-btn ad-btn--primary",
      text: this.state.mode === "auto" ? t("保存并新建今日日记") : t("记住设定"),
      attr: { type: "button" },
    });
    okBtn.onclick = async () => {
      if (this.state.mode === "auto" && this.state.templateSource === "file" && !this.state.templatePath.trim()) {
        this.state.templateSource = "none";
      }
      const shared = getSharedJournalPromptState(this.app);
      shared.dismissedDay = "";
      const savedPolicy = await this.plugin?.updateJournalPolicy?.({
        ...this.state,
        configured: true,
      });
      this.settle({ saved: true, policy: savedPolicy || { ...this.state, configured: true } });
    };
  }

  renderPlacementOptions() {
    const sec = this._placeSec;
    if (!sec) return;
    sec.empty();

    const stepNum = this.state.mode === "auto" ? "3" : "2";
    sec.createDiv({
      cls: "ad-jsetup__label",
      text: this.state.mode === "auto"
        ? t("{n}. AI 自动记录区域放到模板的哪里？", { n: stepNum })
        : t("{n}. 等你建好日记后，AI 自动记录默认放哪里？", { n: stepNum }),
    });

    const seg = sec.createDiv({ cls: "ad-seg ad-jsetup__seg" });
    const opts = [
      ["bottom", t("日记末尾")],
      ["top", t("日记开头")],
      ["after-heading", t("指定标题下")],
      ["placeholder", this._hasAiToken ? t("模板 {{ai}} 处（已检测到）") : t("模板 {{ai}} 处")],
    ];
    for (const [id, label] of opts) {
      const b = seg.createEl("button", {
        cls: "ad-seg__btn" + (this.state.aiPlacement === id ? " is-on" : ""),
        text: label,
        attr: { type: "button", "aria-pressed": String(this.state.aiPlacement === id) },
      });
      b.onclick = () => {
        this._userPickedPlacement = true;
        this.state.aiPlacement = id;
        this.renderPlacementOptions();
      };
    }

    if (this.state.aiPlacement === "top") {
      sec.createDiv({ cls: "ad-jsetup__hint", text: t("会自动避开 YAML 属性头（frontmatter），插在正文最上方。") });
    } else if (this.state.aiPlacement === "placeholder") {
      sec.createDiv({
        cls: "ad-jsetup__hint",
        text: this._hasAiToken
          ? t("已识别模板中的 {{ai}} 标记，首次写入 AI 记录时会原位替换它。")
          : t("在模板任意位置写一行 {{ai}} 即可精确占位；未写该标记时将落在日记末尾。"),
      });
    } else if (this.state.aiPlacement === "after-heading") {
      const box = sec.createDiv({ cls: "ad-jsetup__headingbox" });
      if (this._headings.length) {
        const sel = box.createEl("select", { cls: "ad-select" });
        const matched = this._headings.find((h) => h.raw === this.state.aiAnchorHeading || h.text === this.state.aiAnchorHeading);
        if (!this.state.aiAnchorHeading && this._headings[0]) this.state.aiAnchorHeading = this._headings[0].raw;
        for (const h of this._headings) {
          const opt = sel.createEl("option", { value: h.raw, text: h.raw });
          if (h.raw === this.state.aiAnchorHeading || (!matched && h === this._headings[0])) opt.selected = true;
        }
        const customOpt = sel.createEl("option", { value: "__custom__", text: t("手动输入其他标题…") });
        const useCustom = Boolean(this.state.aiAnchorHeading && !this._headings.some((h) => h.raw === this.state.aiAnchorHeading || h.text === this.state.aiAnchorHeading));
        if (useCustom) customOpt.selected = true;

        let customInput = null;
        const syncCustomInput = (show) => {
          if (show && !customInput) {
            customInput = box.createEl("input", {
              cls: "ad-input",
              type: "text",
              value: this.state.aiAnchorHeading || "",
              attr: { placeholder: t("如：## AI 记录 或 今日工作") },
            });
            customInput.oninput = () => { this.state.aiAnchorHeading = customInput.value.trim(); };
          } else if (!show && customInput) {
            customInput.remove();
            customInput = null;
          }
        };
        if (useCustom) syncCustomInput(true);
        sel.onchange = () => {
          if (sel.value === "__custom__") {
            syncCustomInput(true);
          } else {
            this.state.aiAnchorHeading = sel.value;
            syncCustomInput(false);
          }
        };
      } else {
        const input = box.createEl("input", {
          cls: "ad-input",
          type: "text",
          value: this.state.aiAnchorHeading || "",
          attr: { placeholder: t("输入目标标题，如：## AI 记录 或 今日工作") },
        });
        input.oninput = () => { this.state.aiAnchorHeading = input.value.trim(); };
      }
      sec.createDiv({ cls: "ad-jsetup__hint", text: t("当天日记里若找不到该标题，将自动落到日记末尾。") });
    }
  }
}

export async function openSharedJournalSetupModal(plugin, { day = "", targetPath = "", caller = "agent-deck", manualTrigger = false } = {}) {
  const app = plugin?.app;
  if (!app) return { saved: false, dismissed: false };
  const shared = getSharedJournalPromptState(app);
  if (shared.modalPromise) return shared.modalPromise;
  if (!manualTrigger && day && shared.dismissedDay === day) {
    return { saved: false, dismissed: true };
  }
  const initialPolicy = plugin.getJournalPolicy?.();
  shared.modalPromise = new Promise((resolve) => {
    const modal = new JournalSetupModal(app, plugin, {
      day,
      targetPath,
      caller,
      initialPolicy,
      onResolve: resolve,
    });
    modal.open();
  }).finally(() => {
    shared.modalPromise = null;
  });
  return shared.modalPromise;
}
