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
