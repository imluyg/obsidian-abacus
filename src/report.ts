import type { Vec } from "./types";

/** 周报只是一个纯函数：输入一周的账本视图，输出 Markdown 字符串 */

export interface ReportDaily {
  /** 2026-11-09 */
  date: string;
  /** 周一 */
  weekday: string;
  vec: Vec;
}

export interface ReportProject {
  name: string;
  vec: Vec;
}

export interface ReportFile {
  path: string;
  vec: Vec;
}

export interface WeeklyReportInput {
  week: string;
  weekStartLabel: string;
  weekEndLabel: string;
  add: Vec;
  del: Vec;
  activeDays: number;
  /** 达到每日目标的天数（未设目标时为 0） */
  goalDays: number;
  dailyGoal: number;
  streak: number;
  total: Vec;
  fileCount: number;
  daily: ReportDaily[];
  projects: ReportProject[];
  topFiles: ReportFile[];
  generatedAt: number;
}

const n = (v: number) => Math.round(v).toLocaleString("en-US");

export function buildWeeklyReport(i: WeeklyReportInput): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push("tags:");
  lines.push("  - 统计");
  lines.push("  - 周报");
  lines.push(`week: ${i.week}`);
  lines.push("---");
  lines.push("");
  lines.push(`# 周报 ${i.week}`);
  lines.push("");
  lines.push(
    `${i.weekStartLabel} ~ ${i.weekEndLabel} · 由 Abacus 生成于 ${new Date(
      i.generatedAt
    ).toLocaleString("zh-CN")}`
  );
  lines.push("");

  lines.push("## 总览");
  lines.push("");
  lines.push("| 指标 | 汉字 | 英文词 |");
  lines.push("| --- | ---: | ---: |");
  lines.push(`| 本周新增 | ${n(i.add.cjk)} | ${n(i.add.lat)} |`);
  lines.push(`| 本周删改 | −${n(i.del.cjk)} | −${n(i.del.lat)} |`);
  lines.push(`| 净增长 | ${n(i.add.cjk - i.del.cjk)} | ${n(i.add.lat - i.del.lat)} |`);
  lines.push(`| 活跃天数 | ${i.activeDays} / ${i.daily.length} | |`);
  if (i.dailyGoal > 0) lines.push(`| 达标天数（≥${n(i.dailyGoal)}字） | ${i.goalDays} / ${i.daily.length} | |`);
  lines.push(`| 连续写作 | ${i.streak} 天 | |`);
  lines.push(`| 全库存量 | ${n(i.total.cjk)} | ${n(i.total.lat)} |`);
  lines.push("");

  lines.push("## 每日");
  lines.push("");
  lines.push("| 日期 | 星期 | 汉字 | 英文词 |");
  lines.push("| --- | --- | ---: | ---: |");
  for (const d of i.daily) {
    const mark = d.vec.cjk + d.vec.lat === 0 ? "·" : n(d.vec.cjk);
    lines.push(`| ${d.date} | ${d.weekday} | ${mark} | ${d.vec.cjk + d.vec.lat === 0 ? "·" : n(d.vec.lat)} |`);
  }
  lines.push("");

  if (i.projects.length > 0) {
    lines.push("## 项目");
    lines.push("");
    lines.push("| 项目 | 汉字 | 英文词 |");
    lines.push("| --- | ---: | ---: |");
    for (const p of i.projects) {
      lines.push(`| ${p.name} | ${n(p.vec.cjk)} | ${n(p.vec.lat)} |`);
    }
    lines.push("");
  }

  if (i.topFiles.length > 0) {
    lines.push("## 本周改动最多的文件");
    lines.push("");
    lines.push("| 文件 | 汉字 | 英文词 |");
    lines.push("| --- | ---: | ---: |");
    for (const f of i.topFiles) {
      lines.push(`| ${linkFor(f.path)} | ${n(f.vec.cjk)} | ${n(f.vec.lat)} |`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(`> 账本口径：只计「新增」，删改单列。数据目录 \`.obsidian/plugins/abacus/stats/\`。`);
  lines.push("");

  return lines.join("\n");
}

/** 生成 [[双链]]，去掉 .md 后缀 */
function linkFor(path: string): string {
  const clean = path.replace(/\.md$/i, "");
  return `[[${clean}]]`;
}


/* ------------------------------------------------------------------ */
/* 年度报告                                                             */
/* ------------------------------------------------------------------ */

export interface YearMonthRow {
  month: number;
  vec: Vec;
  activeDays: number;
}

export interface YearReportInput {
  year: number;
  add: Vec;
  del: Vec;
  activeDays: number;
  bestDay: { date: string; vec: Vec } | null;
  longestStreak: number;
  months: YearMonthRow[];
  projects: ReportProject[];
  topFiles: ReportFile[];
  /** dayKey -> 当天写作量，用于热力图 */
  daily: Record<string, Vec>;
  generatedAt: number;
}

/** 五档色阶，按当天写作量分桶 */
const LEVELS = [0, 200, 500, 1000, 2000];

function levelOf(v: Vec): number {
  const total = v.cjk + v.lat;
  if (total <= 0) return 0;
  let lv = 1;
  for (let i = 1; i < LEVELS.length; i++) if (total >= LEVELS[i]) lv = i + 1;
  return lv;
}

/**
 * 热力图用 HTML 表格输出。Obsidian 的阅读视图会正常渲染内联 HTML，
 * 颜色走主题变量 + opacity，深色浅色主题都不用单独适配。
 */
function heatmapHtml(daily: Record<string, Vec>, year: number): string {
  const first = new Date(year, 0, 1);
  const shift = (first.getDay() + 6) % 7; // 周一为一周起点
  const cursor = new Date(year, 0, 1 - shift);
  const end = new Date(year, 11, 31);
  const weeks: string[] = [];
  const cells: string[][] = Array.from({ length: 7 }, () => []);

  while (cursor <= end) {
    const week: string[] = [];
    for (let d = 0; d < 7; d++) {
      const ts = cursor.getTime();
      const inYear = cursor.getFullYear() === year;
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      const v = inYear ? daily[key] : undefined;
      const lv = v ? levelOf(v) : -1;
      if (lv < 0) {
        week.push('<div style="width:11px;height:11px"></div>');
      } else {
        const opacity = [0.08, 0.28, 0.5, 0.72, 1][lv];
        const tip = v ? `${key}　汉字 ${v.cjk}　英文词 ${v.lat}` : `${key}　无记录`;
        week.push(
          `<div title="${tip}" style="width:11px;height:11px;border-radius:2px;background:var(--interactive-accent);opacity:${opacity}"></div>`
        );
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(`<div style="display:flex;flex-direction:column;gap:3px">${week.join("")}</div>`);
  }

  return [
    '<div style="display:flex;gap:3px;overflow-x:auto;padding:6px 0">',
    weeks.join(""),
    "</div>",
    '<div style="color:var(--text-faint);font-size:0.8em">单元格悬停看当天数字；颜色越深写得越多。</div>',
  ].join("\n");
}

export function buildYearReport(i: YearReportInput): string {
  const lines: string[] = [];
  const perDay = i.activeDays > 0 ? Math.round(i.add.cjk / i.activeDays) : 0;

  lines.push("---");
  lines.push("tags:");
  lines.push("  - 统计");
  lines.push("  - 年度报告");
  lines.push(`year: ${i.year}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${i.year} 年度报告`);
  lines.push("");
  lines.push(`由 Abacus 生成于 ${new Date(i.generatedAt).toLocaleString("zh-CN")}`);
  lines.push("");

  lines.push("## 总览");
  lines.push("");
  lines.push("| 指标 | 汉字 | 英文词 |");
  lines.push("| --- | ---: | ---: |");
  lines.push(`| 全年新增 | ${n(i.add.cjk)} | ${n(i.add.lat)} |`);
  lines.push(`| 全年删改 | −${n(i.del.cjk)} | −${n(i.del.lat)} |`);
  lines.push(`| 净增长 | ${n(i.add.cjk - i.del.cjk)} | ${n(i.add.lat - i.del.lat)} |`);
  lines.push(`| 活跃天数 | ${i.activeDays} / 365 | |`);
  lines.push(`| 写作日均 | ${n(perDay)} 汉字 | |`);
  lines.push(`| 最长连续 | ${i.longestStreak} 天 | |`);
  if (i.bestDay) {
    lines.push(`| 最高产一天 | ${i.bestDay.date}（${n(i.bestDay.vec.cjk)} 汉字） | |`);
  }
  lines.push("");

  lines.push("## 热力图");
  lines.push("");
  lines.push(heatmapHtml(i.daily, i.year));
  lines.push("");

  lines.push("## 逐月");
  lines.push("");
  lines.push("| 月份 | 汉字 | 英文词 | 活跃天数 |");
  lines.push("| --- | ---: | ---: | ---: |");
  for (const m of i.months) {
    lines.push(`| ${m.month} 月 | ${n(m.vec.cjk)} | ${n(m.vec.lat)} | ${m.activeDays} |`);
  }
  lines.push("");

  if (i.projects.length > 0) {
    lines.push("## 项目");
    lines.push("");
    lines.push("| 项目 | 汉字 | 英文词 |");
    lines.push("| --- | ---: | ---: |");
    for (const p of i.projects) lines.push(`| ${p.name} | ${n(p.vec.cjk)} | ${n(p.vec.lat)} |`);
    lines.push("");
  }

  if (i.topFiles.length > 0) {
    lines.push("## 改动最多的文件");
    lines.push("");
    lines.push("| 文件 | 汉字 | 英文词 |");
    lines.push("| --- | ---: | ---: |");
    for (const f of i.topFiles) lines.push(`| ${linkFor(f.path)} | ${n(f.vec.cjk)} | ${n(f.vec.lat)} |`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("> 只计「新增」，删改单列。账本是唯一数据源，这份报告可以随时重新生成。");
  lines.push("");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* CSV 导出                                                             */
/* ------------------------------------------------------------------ */

export interface CsvRow {
  date: string;
  add: Vec;
  del: Vec;
  entries: number;
}

export function buildCsv(rows: CsvRow[]): string {
  const out = ["日期,汉字新增,英文词新增,汉字删改,英文词删改,事件数"];
  for (const r of rows) {
    out.push(`${r.date},${r.add.cjk},${r.add.lat},${r.del.cjk},${r.del.lat},${r.entries}`);
  }
  return out.join("\n") + "\n";
}
