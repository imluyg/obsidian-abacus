import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type { Vec } from "./types";

export const VIEW_TYPE_STATS = "abacus-view";

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

export interface HealthInfo {
  ok: boolean;
  problems: string[];
  months: number;
  entries: number;
  checkedAt: number;
}

export interface ProjectFileRow {
  path: string;
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
  projectFiles: ProjectFileRow[];
  selectedProject?: string;
  dailyGoal: number;
  weeklyGoal: number;
  health?: HealthInfo;
  scanning: boolean;
  progress?: { done: number; total: number };
  updatedAt: number;
}

export interface ViewHooks {
  onRescan: () => void;
  onRange: (days: number) => void;
  onAudit: () => void;
  onProject: (name: string) => void;
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

    // 今日目标：有目标才出现
    if (d.dailyGoal > 0) {
      const pct = Math.min(100, Math.round((d.todayAdd.cjk / d.dailyGoal) * 100));
      const goal = root.createDiv({ cls: "scs-goal" });
      if (d.todayAdd.cjk >= d.dailyGoal) goal.addClass("is-done");
      const track = goal.createDiv({ cls: "scs-goal-track" });
      track.createDiv({ cls: "scs-goal-fill", attr: { style: `width:${pct}%` } });
      goal.createDiv({
        cls: "scs-goal-text",
        text: `${fmt(d.todayAdd.cjk)} / ${fmt(d.dailyGoal)} 字 · ${pct}%`,
      });
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

    if (d.weeklyGoal > 0) {
      const pct = Math.min(100, Math.round((d.weekAdd.cjk / d.weeklyGoal) * 100));
      const line = root.createDiv({
        cls: "scs-goal-line" + (d.weekAdd.cjk >= d.weeklyGoal ? " is-done" : ""),
        text: `本周 ${fmt(d.weekAdd.cjk)} / ${fmt(d.weeklyGoal)} 字 · ${pct}%`,
      });
      line.setAttr("title", `本周目标 ${fmt(d.weeklyGoal)} 汉字`);
    }

    // 项目
    if (d.projects.length > 0) {
      const proj = root.createDiv({ cls: "scs-projects" });
      proj.createDiv({ cls: "scs-section-title", text: "项目" });
      const head = proj.createDiv({ cls: "scs-project-row is-head" });
      head.createDiv({ cls: "scs-project-name", text: "" });
      head.createDiv({ cls: "scs-project-num", text: "本月" });
      head.createDiv({ cls: "scs-project-num", text: "累计" });
      for (const p of d.projects) {
        const selected = d.selectedProject === p.name;
        const row = proj.createDiv({ cls: "scs-project-row is-clickable" + (selected ? " is-selected" : "") });
        row.createDiv({ cls: "scs-project-name", text: p.name });
        row.createDiv({ cls: "scs-project-num", text: fmt(p.month.cjk) });
        row.createDiv({ cls: "scs-project-num is-dim", text: fmt(p.total.cjk) });
        row.title = `${p.name}\n本月 汉字 ${fmt(p.month.cjk)} / 词 ${fmt(p.month.lat)}\n累计 汉字 ${fmt(p.total.cjk)} / 词 ${fmt(p.total.lat)}\n点击查看该项目下的文件`;
        row.onclick = () => this.hooks.onProject(p.name);
      }

      if (d.selectedProject) {
        const files = proj.createDiv({ cls: "scs-files" });
        files.createDiv({ cls: "scs-files-title", text: d.selectedProject });
        if (d.projectFiles.length === 0) {
          files.createDiv({ cls: "scs-files-empty", text: "本月没有改动" });
        }
        for (const f of d.projectFiles) {
          const item = files.createDiv({ cls: "scs-file-row" });
          item.createDiv({ cls: "scs-file-name", text: f.path.split("/").pop() ?? f.path });
          item.createDiv({
            cls: "scs-file-num",
            text: f.month.cjk > 0 ? `+${fmt(f.month.cjk)}` : fmt(f.total.cjk),
          });
          item.title = `${f.path}\n本月新增 汉字 ${fmt(f.month.cjk)} / 词 ${fmt(f.month.lat)}\n全文 汉字 ${fmt(f.total.cjk)} / 词 ${fmt(f.total.lat)}`;
        }
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

    // 账本健康：常驻显示，比启动时弹一次 Notice 可靠
    const healthEl = root.createDiv({ cls: "scs-health" });
    if (!d.health) {
      healthEl.setText("账本检查中…");
    } else if (d.health.ok) {
      healthEl.setText(`账本正常 · ${d.health.months} 个月 · ${fmt(d.health.entries)} 条`);
    } else {
      healthEl.addClass("is-bad");
      healthEl.setText(`⚠ 账本异常 ${d.health.problems.length} 项 · 点击排查`);
      healthEl.title = d.health.problems.join("\n");
    }
    healthEl.onclick = () => this.hooks.onAudit();

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
