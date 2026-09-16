import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type { Vec } from "./types";

export const VIEW_TYPE_STATS = "sixcolor-stats-view";

export interface DayBar {
  day: string;
  label: string;
  vec: Vec;
  isToday: boolean;
}

export interface ProjectRow {
  name: string;
  month: Vec;
  total: Vec;
}

export interface PanelData {
  todayAdd: Vec;
  todayDel: Vec;
  weekAdd: Vec;
  monthAdd: Vec;
  total: Vec;
  fileCount: number;
  current?: { path: string; vec: Vec };
  days: DayBar[];
  range: number;
  streak: number;
  projects: ProjectRow[];
  scanning: boolean;
  progress?: { done: number; total: number };
  updatedAt: number;
}

export interface ViewHooks {
  onRescan: () => void;
  onRange: (days: number) => void;
}

const RANGES = [7, 30];
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export class StatsView extends ItemView {
  private data: PanelData | null = null;

  constructor(leaf: WorkspaceLeaf, private hooks: ViewHooks) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_STATS;
  }

  getDisplayText(): string {
    return "字数统计";
  }

  getIcon(): string {
    return "calculator";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  setData(data: PanelData): void {
    this.data = data;
    this.render();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("scs-panel");

    const header = root.createDiv({ cls: "scs-header" });
    header.createDiv({ cls: "scs-title", text: "今日" });
    const buttons = header.createDiv({ cls: "scs-header-actions" });

    for (const r of RANGES) {
      const b = buttons.createEl("button", {
        cls: "scs-range-btn" + (this.data?.range === r ? " is-active" : ""),
        text: `${r}天`,
      });
      b.onclick = () => this.hooks.onRange(r);
    }

    const refresh = buttons.createEl("button", {
      cls: "scs-icon-btn",
      attr: { "aria-label": "重新扫描" },
    });
    setIcon(refresh, "refresh-cw");
    refresh.onclick = () => this.hooks.onRescan();

    if (!this.data) {
      root.createDiv({ cls: "scs-empty", text: "正在读取…" });
      return;
    }
    const d = this.data;

    if (d.scanning && d.progress) {
      root.createDiv({
        cls: "scs-progress",
        text: `扫描中 ${d.progress.done} / ${d.progress.total}`,
      });
    }

    // 今日主数字
    const hero = root.createDiv({ cls: "scs-hero" });
    hero.createDiv({ cls: "scs-hero-num", text: fmt(d.todayAdd.cjk) });
    hero.createDiv({ cls: "scs-hero-unit", text: "汉字" });

    const heroSub = root.createDiv({ cls: "scs-hero-sub" });
    heroSub.createSpan({ text: `英文词 ${fmt(d.todayAdd.lat)}` });
    if (d.todayDel.cjk > 0 || d.todayDel.lat > 0) {
      heroSub.createSpan({
        cls: "scs-del",
        text: `　删改 −${fmt(d.todayDel.cjk)} / −${fmt(d.todayDel.lat)}`,
      });
    }
    if (d.streak > 0) {
      heroSub.createSpan({ cls: "scs-streak", text: `　连续 ${d.streak} 天` });
    }

    // 趋势图
    const chartWrap = root.createDiv({ cls: "scs-chart-wrap" });
    const chart = chartWrap.createDiv({ cls: "scs-chart" });
    const max = Math.max(1, ...d.days.map((x) => x.vec.cjk + x.vec.lat));
    const labelEvery = d.days.length > 10 ? Math.ceil(d.days.length / 6) : 1;
    d.days.forEach((bar, i) => {
      const value = bar.vec.cjk + bar.vec.lat;
      const col = chart.createDiv({ cls: "scs-bar-col" });
      if (bar.isToday) col.addClass("is-today");
      const track = col.createDiv({ cls: "scs-bar-track" });
      const h = value <= 0 ? 0 : Math.max(4, Math.round((value / max) * 100));
      track.createDiv({ cls: "scs-bar", attr: { style: `height:${h}%` } });
      const showLabel =
        d.days.length <= 7 || bar.isToday || (d.days.length - 1 - i) % labelEvery === 0;
      if (showLabel) col.createDiv({ cls: "scs-bar-label", text: bar.label });
      col.title = `${bar.day}　汉字 ${fmt(bar.vec.cjk)}　英文词 ${fmt(bar.vec.lat)}`;
    });

    // 汇总
    const grid = root.createDiv({ cls: "scs-grid" });
    this.metric(grid, "本周", d.weekAdd);
    this.metric(grid, "本月", d.monthAdd);
    this.metric(grid, "全库", d.total);

    // 项目
    if (d.projects.length > 0) {
      const proj = root.createDiv({ cls: "scs-projects" });
      proj.createDiv({ cls: "scs-section-title", text: "项目" });
      const head = proj.createDiv({ cls: "scs-project-row is-head" });
      head.createDiv({ cls: "scs-project-name", text: "" });
      head.createDiv({ cls: "scs-project-num", text: "本月" });
      head.createDiv({ cls: "scs-project-num", text: "累计" });
      for (const p of d.projects) {
        const row = proj.createDiv({ cls: "scs-project-row" });
        row.createDiv({ cls: "scs-project-name", text: p.name });
        row.createDiv({ cls: "scs-project-num", text: fmt(p.month.cjk) });
        row.createDiv({ cls: "scs-project-num is-dim", text: fmt(p.total.cjk) });
        row.title = `${p.name}\n本月 汉字 ${fmt(p.month.cjk)} / 词 ${fmt(p.month.lat)}\n累计 汉字 ${fmt(p.total.cjk)} / 词 ${fmt(p.total.lat)}`;
      }
    }

    // 当前文件
    if (d.current) {
      const cur = root.createDiv({ cls: "scs-current" });
      cur.createDiv({ cls: "scs-current-label", text: "当前文件" });
      cur.createDiv({ cls: "scs-current-name", text: d.current.path.split("/").pop() ?? d.current.path });
      cur.createDiv({
        cls: "scs-current-num",
        text: `汉字 ${fmt(d.current.vec.cjk)}　英文词 ${fmt(d.current.vec.lat)}`,
      });
    }

    root.createDiv({
      cls: "scs-foot",
      text: `${fmt(d.fileCount)} 个文件　更新于 ${new Date(d.updatedAt).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      })}`,
    });
  }

  private metric(parent: HTMLElement, label: string, v: Vec): void {
    const box = parent.createDiv({ cls: "scs-metric" });
    box.createDiv({ cls: "scs-metric-label", text: label });
    box.createDiv({ cls: "scs-metric-main", text: fmt(v.cjk) });
    box.createDiv({ cls: "scs-metric-sub", text: `词 ${fmt(v.lat)}` });
  }
}
