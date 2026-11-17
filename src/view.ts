import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type { Vec } from "./types";
import { L } from "./i18n";
import { heatLevel, type YearHeatmap } from "./stats";

export const VIEW_TYPE_STATS = "abacus-view";

export interface DayBar {
  day: string;
  label: string;
  vec: Vec;
  isToday: boolean;
  /** 累计视图的自定义提示；普通柱状图用 chartTip */
  tip?: string;
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
  /** 当前所选范围的合计新增 */
  rangeAdd: Vec;
  total: Vec;
  fileCount: number;
  current?: { path: string; vec: Vec };
  days: DayBar[];
  range: number;
  heat: YearHeatmap;
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

const RANGES = [7, 30, 90, 365, 0];
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export class StatsView extends ItemView {
  private data: PanelData | null = null;
  private progressEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, private hooks: ViewHooks) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_STATS;
  }

  getDisplayText(): string {
    return L().viewName;
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

  /** 扫描进度只改这一行，不重建整个面板 */
  setProgress(progress: { done: number; total: number } | null): void {
    const el = this.progressEl;
    if (!el) return;
    if (progress) {
      el.style.display = "";
      el.setText(L().scanning(progress.done, progress.total));
    } else {
      el.style.display = "none";
    }
  }

  private render(): void {
    const t = L();
    const root = this.contentEl;
    const prevScrollTop = root.scrollTop;
    const prevHeatScroll =
      root.querySelector<HTMLElement>(".scs-heat-scroll")?.scrollLeft ?? 0;
    const host = document.createElement("div");
    root.addClass("scs-panel");

    const header = host.createDiv({ cls: "scs-header" });
    header.createDiv({ cls: "scs-title", text: t.today });
    const buttons = header.createDiv({ cls: "scs-header-actions" });

    for (const r of RANGES) {
      const b = buttons.createEl("button", {
        cls: "scs-range-btn" + (this.data?.range === r ? " is-active" : ""),
        text: r === 0 ? t.rangeCumulative : r === 365 ? t.rangeYear : t.rangeDays(r),
      });
      b.onclick = () => this.hooks.onRange(r);
    }

    const refresh = buttons.createEl("button", {
      cls: "scs-icon-btn",
      attr: { "aria-label": t.rescan },
    });
    setIcon(refresh, "refresh-cw");
    refresh.onclick = () => this.hooks.onRescan();

    const progressEl = host.createDiv({ cls: "scs-progress" });
    this.progressEl = progressEl;
    progressEl.style.display = "none";

    if (!this.data) {
      host.createDiv({ cls: "scs-empty", text: t.reading });
      this.commit(root, host, prevScrollTop, prevHeatScroll);
      return;
    }
    const d = this.data;

    if (d.scanning && d.progress) {
      progressEl.style.display = "";
      progressEl.setText(t.scanning(d.progress.done, d.progress.total));
    }

    // 今日主数字
    const hero = host.createDiv({ cls: "scs-hero" });
    hero.createDiv({ cls: "scs-hero-num", text: fmt(d.todayAdd.cjk) });
    hero.createDiv({ cls: "scs-hero-unit", text: t.cjk });

    const heroSub = host.createDiv({ cls: "scs-hero-sub" });
    heroSub.createSpan({ text: t.latinWords(fmt(d.todayAdd.lat)) });
    if (d.todayDel.cjk > 0 || d.todayDel.lat > 0) {
      heroSub.createSpan({
        cls: "scs-del",
        text: t.deleted(fmt(d.todayDel.cjk), fmt(d.todayDel.lat)),
      });
    }
    if (d.streak > 0) {
      heroSub.createSpan({ cls: "scs-streak", text: t.streak(d.streak) });
    }

    // 今日目标：有目标才出现
    if (d.dailyGoal > 0) {
      const pct = Math.min(100, Math.round((d.todayAdd.cjk / d.dailyGoal) * 100));
      const goal = host.createDiv({ cls: "scs-goal" });
      if (d.todayAdd.cjk >= d.dailyGoal) goal.addClass("is-done");
      const track = goal.createDiv({ cls: "scs-goal-track" });
      track.createDiv({ cls: "scs-goal-fill", attr: { style: `width:${pct}%` } });
      goal.createDiv({
        cls: "scs-goal-text",
        text: t.goalText(fmt(d.todayAdd.cjk), fmt(d.dailyGoal), pct),
      });
    }

    // 当前范围合计：图表上方的一行，随 7天 / 30天 / 90天 / 全年 / 累计切换
    const totalLabel =
      d.range === 0
        ? t.rangeCumulativeTotal
        : d.range === 365
          ? t.rangeYearTotal
          : `${t.rangeDays(d.range)}${t.rangeTotalSuffix}`;
    const rangeTotal = host.createDiv({ cls: "scs-range-total" });
    rangeTotal.createSpan({ cls: "scs-range-total-label", text: totalLabel });
    rangeTotal.createSpan({ cls: "scs-range-total-num", text: fmt(d.rangeAdd.cjk) });
    rangeTotal.createSpan({ cls: "scs-range-total-unit", text: t.cjk });
    rangeTotal.createSpan({ cls: "scs-range-total-sub", text: t.latinWords(fmt(d.rangeAdd.lat)) });

    // 趋势图
    const chartWrap = host.createDiv({ cls: "scs-chart-wrap" });
    const chart = chartWrap.createDiv({
      cls: "scs-chart" + (d.range === 90 || d.days.length > 24 ? " is-dense" : ""),
    });
    const max = Math.max(1, ...d.days.map((x) => x.vec.cjk + x.vec.lat));
    const labelEvery =
      d.range === 365 ? 1 : d.days.length > 10 ? Math.ceil(d.days.length / 6) : 1;
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
      col.title = bar.tip ?? t.chartTip(bar.day, fmt(bar.vec.cjk), fmt(bar.vec.lat));
    });
    if (d.range === 0) {
      chartWrap.createDiv({ cls: "scs-chart-note", text: t.cumulativeNote });
    }

    this.renderHeatmap(host, d.heat);

    // 汇总
    const grid = host.createDiv({ cls: "scs-grid" });
    this.metric(grid, t.week, d.weekAdd);
    this.metric(grid, t.month, d.monthAdd);
    this.metric(grid, t.all, d.total);

    if (d.weeklyGoal > 0) {
      const pct = Math.min(100, Math.round((d.weekAdd.cjk / d.weeklyGoal) * 100));
      const line = host.createDiv({
        cls: "scs-goal-line" + (d.weekAdd.cjk >= d.weeklyGoal ? " is-done" : ""),
        text: t.weekGoalText(fmt(d.weekAdd.cjk), fmt(d.weeklyGoal), pct),
      });
      line.setAttr("title", t.weekGoalTitle(fmt(d.weeklyGoal)));
    }

    // 项目
    if (d.projects.length > 0) {
      const proj = host.createDiv({ cls: "scs-projects" });
      proj.createDiv({ cls: "scs-section-title", text: t.projects });
      const head = proj.createDiv({ cls: "scs-project-row is-head" });
      head.createDiv({ cls: "scs-project-name", text: "" });
      head.createDiv({ cls: "scs-project-num", text: t.month });
      head.createDiv({ cls: "scs-project-num", text: t.runningTotal });
      for (const p of d.projects) {
        const selected = d.selectedProject === p.name;
        const row = proj.createDiv({
          cls: "scs-project-row is-clickable" + (selected ? " is-selected" : ""),
        });
        row.createDiv({ cls: "scs-project-name", text: p.name });
        row.createDiv({ cls: "scs-project-num", text: fmt(p.month.cjk) });
        row.createDiv({ cls: "scs-project-num is-dim", text: fmt(p.total.cjk) });
        row.title = t.projectTip(
          p.name,
          fmt(p.month.cjk),
          fmt(p.month.lat),
          fmt(p.total.cjk),
          fmt(p.total.lat)
        );
        row.onclick = () => this.hooks.onProject(p.name);
      }

      if (d.selectedProject) {
        const files = proj.createDiv({ cls: "scs-files" });
        files.createDiv({ cls: "scs-files-title", text: d.selectedProject });
        if (d.projectFiles.length === 0) {
          files.createDiv({ cls: "scs-files-empty", text: t.noChangesThisMonth });
        }
        for (const f of d.projectFiles) {
          const item = files.createDiv({ cls: "scs-file-row" });
          item.createDiv({ cls: "scs-file-name", text: f.path.split("/").pop() ?? f.path });
          item.createDiv({
            cls: "scs-file-num",
            text: f.month.cjk > 0 ? `+${fmt(f.month.cjk)}` : fmt(f.total.cjk),
          });
          item.title = t.fileTip(
            f.path,
            fmt(f.month.cjk),
            fmt(f.month.lat),
            fmt(f.total.cjk),
            fmt(f.total.lat)
          );
        }
      }
    }

    // 当前文件
    if (d.current) {
      const cur = host.createDiv({ cls: "scs-current" });
      cur.createDiv({ cls: "scs-current-label", text: t.currentFile });
      cur.createDiv({
        cls: "scs-current-name",
        text: d.current.path.split("/").pop() ?? d.current.path,
      });
      cur.createDiv({
        cls: "scs-current-num",
        text: t.currentNum(fmt(d.current.vec.cjk), fmt(d.current.vec.lat)),
      });
    }

    // 账本健康：常驻显示，比启动时弹一次 Notice 可靠
    const healthEl = host.createDiv({ cls: "scs-health" });
    if (!d.health) {
      healthEl.setText(t.healthChecking);
    } else if (d.health.ok) {
      healthEl.setText(t.healthOk(d.health.months, fmt(d.health.entries)));
    } else {
      healthEl.addClass("is-bad");
      healthEl.setText(t.healthBad(d.health.problems.length));
      healthEl.title = d.health.problems.join("\n");
    }
    healthEl.onclick = () => this.hooks.onAudit();

    const time = new Date(d.updatedAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    host.createDiv({ cls: "scs-foot", text: t.foot(fmt(d.fileCount), time) });
    this.commit(root, host, prevScrollTop, prevHeatScroll);
  }

  /** 一次性替换内容并恢复滚动位置，避免重建过程中 reflow 与滚动跳动 */
  private commit(root: HTMLElement, host: HTMLElement, prevTop: number, prevHeat: number): void {
    root.replaceChildren(host);
    root.scrollTop = prevTop;
    const heatScroll = root.querySelector<HTMLElement>(".scs-heat-scroll");
    if (heatScroll) heatScroll.scrollLeft = prevHeat;
  }

  /**
   * 全年热力图：周优先的 7 行网格，横向滚动。
   * 格子只负责布局与提示，颜色由内层 fill 承担，
   * 这样“今天”的描边不会被低档位的透明度一起压暗。
   */
  private renderHeatmap(parent: HTMLElement, heat: YearHeatmap): void {
    const t = L();
    const opacities = [0, 0.28, 0.5, 0.72, 1];
    const wrap = parent.createDiv({ cls: "scs-heat" });
    wrap.createDiv({ cls: "scs-section-title", text: t.heatTitle(heat.year) });

    const scroll = wrap.createDiv({ cls: "scs-heat-scroll" });
    const body = scroll.createDiv({ cls: "scs-heat-body" });

    const top = body.createDiv({ cls: "scs-heat-top" });
    top.createDiv({ cls: "scs-heat-corner" });
    const months = top.createDiv({
      cls: "scs-heat-months",
      attr: { style: `width:${heat.weeks * 14}px` },
    });
    for (const m of heat.months) {
      months.createSpan({
        cls: "scs-heat-month",
        attr: { style: `left:${m.week * 14}px` },
        text: t.monthShort(m.month),
      });
    }

    const main = body.createDiv({ cls: "scs-heat-main" });
    const weekdays = main.createDiv({ cls: "scs-heat-weekdays" });
    for (let i = 0; i < 7; i++) {
      weekdays.createDiv({
        cls: "scs-heat-weekday",
        text: i < 6 && i % 2 === 0 ? t.heatWeekdays[i / 2] : "",
      });
    }

    const grid = main.createDiv({ cls: "scs-heat-grid" });
    for (let w = 0; w < heat.weeks; w++) {
      const col = grid.createDiv({ cls: "scs-heat-week" });
      for (let d = 0; d < 7; d++) {
        const day = heat.days[w * 7 + d];
        const cell = col.createDiv({ cls: "scs-heat-cell" });
        if (!day.inYear || day.future) {
          cell.addClass("is-out");
        } else {
          const lv = heatLevel(day.vec);
          if (lv > 0) {
            cell.createDiv({
              cls: "scs-heat-fill",
              attr: { style: `opacity:${opacities[lv]}` },
            });
            cell.title = t.chartTip(day.day, fmt(day.vec.cjk), fmt(day.vec.lat));
          } else {
            cell.title = day.day;
          }
        }
        if (day.isToday) cell.addClass("is-today");
      }
    }

    const legend = wrap.createDiv({ cls: "scs-heat-legend" });
    legend.createSpan({ text: t.heatLess });
    for (let lv = 0; lv < 5; lv++) {
      const cell = legend.createDiv({ cls: "scs-heat-cell scs-heat-legend-cell" });
      if (lv > 0) {
        cell.createDiv({
          cls: "scs-heat-fill",
          attr: { style: `opacity:${opacities[lv]}` },
        });
      }
    }
    legend.createSpan({ text: t.heatMore });
  }

  private metric(parent: HTMLElement, label: string, v: Vec): void {
    const box = parent.createDiv({ cls: "scs-metric" });
    box.createDiv({ cls: "scs-metric-label", text: label });
    box.createDiv({ cls: "scs-metric-main", text: fmt(v.cjk) });
    box.createDiv({ cls: "scs-metric-sub", text: L().wordsShort(fmt(v.lat)) });
  }
}
